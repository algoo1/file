
import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile, Tag } from '../types.ts';

// Constant for the 48-hour mandatory update rule
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 Hours in milliseconds

export const apiService = {
  getInitialData: async () => {
    const [clients, settings] = await Promise.all([
      databaseService.getClients(),
      databaseService.getSettings()
    ]);
    return { clients, settings };
  },
  
  saveSettings: async (newSettings: Partial<SystemSettings>) => {
    return await databaseService.saveSettings(newSettings);
  },

  connectGoogleDrive: async (creds: { apiKey: string, clientId: string }) => {
    try {
        await googleDriveService.connect(creds.apiKey, creds.clientId);
        await databaseService.saveSettings({ is_google_drive_connected: true });
        return { connected: true };
    } catch (error) {
        await databaseService.saveSettings({ is_google_drive_connected: false });
        throw error;
    }
  },

  addClient: async (name: string) => {
    return await databaseService.addClient(name);
  },
  
  updateClient: async (id: string, updates: Partial<Omit<Client, 'id' | 'synced_files' | 'tags'>>) => {
      return await databaseService.updateClient(id, updates);
  },
  
  addTagToClient: async(clientId: string, tagName: string): Promise<Tag> => {
      return await databaseService.addTagToClient(clientId, tagName);
  },

  removeTagFromClient: async(tagId: string): Promise<void> => {
      return await databaseService.removeTagFromClient(tagId);
  },

  /**
   * Performs a Smart Sync.
   * Logic Updates:
   * 1. Detects new or modified files.
   * 2. Re-adds files if they exist on Drive but are missing/deleted locally.
   * 3. Forces re-processing if a file hasn't been synced in > 48 hours (Stale Check).
   * 4. NOW USES UPSERT INSTEAD OF DELETE-THEN-INSERT to prevent UI flickering.
   */
  syncDataSource: async (
    clientId: string, 
    onProgress: (event: { type: 'INITIAL_LIST', files: Partial<SyncedFile>[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { source_item_id: string } }) => void,
    limitSource?: 'GOOGLE_DRIVE',
    forceFullResync?: boolean
  ): Promise<{ client: Client }> => {
    let client = await databaseService.getClientById(clientId);
    const settings = await databaseService.getSettings();

    if (!client) throw new Error("Client not found.");
    if (!settings.file_search_service_api_key) throw new Error("File Search Service API Key is not set.");

    const isDriveConfigured = !!client.google_drive_folder_url && settings.is_google_drive_connected;
    if (!isDriveConfigured) {
       throw new Error("Google Drive is not configured for this client.");
    }
    
    // 1. Fetch Fresh Metadata from Google Drive
    let allSourceFilesMeta: (Omit<FileObject, 'content' | 'summary' | 'status' | 'statusMessage'>)[] = [];

    try {
        const driveFilesMeta = await googleDriveService.getListOfFiles(client.google_drive_folder_url!);
        
        const getFileType = (mimeType: string): 'pdf' | 'sheet' | 'image' => {
            if (mimeType.includes('spreadsheet')) return 'sheet';
            if (mimeType.startsWith('image/')) return 'image';
            return 'pdf'; 
        };
        
        allSourceFilesMeta.push(...driveFilesMeta.map(f => ({ 
            id: f.id, 
            name: f.name, 
            mimeType: f.mimeType, 
            type: getFileType(f.mimeType), 
            source: 'GOOGLE_DRIVE' as const,
            source_modified_at: f.modifiedTime,
        })));
    } catch (e) {
        console.error("Error listing drive files:", e);
        throw e;
    }

    // 2. Clear Local Search Index (Rebuilt from DB + Updates)
    await fileSearchService.clearIndexForClient(clientId);
    
    // Map existing local files
    const relevantExistingFiles = client.synced_files;
    const existingFilesMap = new Map(relevantExistingFiles.map(f => [f.source_item_id, f]));
    const sourceIds = new Set(allSourceFilesMeta.map(f => f.id));
    
    // 3. Handle Deletions: Remove LOCAL records only if they don't exist in Source anymore
    // Note: We NEVER delete from Google Drive.
    const filesToDelete = relevantExistingFiles.filter(f => !sourceIds.has(f.source_item_id));
    if (filesToDelete.length > 0) {
        await databaseService.deleteClientFiles(filesToDelete.map(f => f.id));
        console.log(`Removed ${filesToDelete.length} obsolete files from local index (Source files missing).`);
    }

    // 4. Determine Work: Detect New, Modified, or Stale (>48h) Files
    // We now attach the existing DB ID to the file meta if available, so we can Update instead of Insert.
    const filesToProcess: (typeof allSourceFilesMeta[0] & { existingId?: string })[] = [];
    const unchangedFiles: SyncedFile[] = [];
    const initialListPayload: Partial<SyncedFile>[] = [];

    for (const sourceFile of allSourceFilesMeta) {
        const existing = existingFilesMap.get(sourceFile.id);
        
        let shouldProcess = false;
        let reason = '';
        
        const isNew = !existing;
        
        if (isNew) {
            shouldProcess = true;
            reason = 'New file detected.';
        } else if (existing) {
            // A. Manual Force Sync
            if (forceFullResync) {
                shouldProcess = true;
                reason = 'Forced re-processing.';
            }
            // B. Failed Previous Sync
            else if (existing.status === 'FAILED') {
                shouldProcess = true;
                reason = 'Retrying failed file.';
            } 
            // C. Source Modification Timestamp Mismatch
            else if (sourceFile.source_modified_at && existing.source_modified_at) {
                const newTime = new Date(sourceFile.source_modified_at).getTime();
                const oldTime = new Date(existing.source_modified_at).getTime();
                if (!isNaN(newTime) && !isNaN(oldTime) && Math.abs(newTime - oldTime) > 1000) {
                    shouldProcess = true;
                    reason = 'Content modified on Drive.';
                }
            } 
            // D. Stale Check (48 Hour Rule)
            // If the file hasn't been synced/indexed by our system in > 48 hours, update it.
            else if (existing.last_synced_at) {
                const lastSyncTime = new Date(existing.last_synced_at).getTime();
                if (Date.now() - lastSyncTime > STALE_THRESHOLD_MS) {
                    shouldProcess = true;
                    reason = 'Periodic 48-hour update.';
                }
            }
        }

        if (shouldProcess) {
            filesToProcess.push({ ...sourceFile, existingId: existing?.id });
            
            initialListPayload.push({
                source_item_id: sourceFile.id,
                name: sourceFile.name,
                status: 'SYNCING', 
                type: sourceFile.type,
                source: sourceFile.source,
                source_modified_at: sourceFile.source_modified_at,
                // Pass the existing ID so the UI knows it's an update, not a new row.
                id: existing?.id, 
                status_message: reason
            });
        } else {
            // Unchanged and Fresh: Just restore to search index
            unchangedFiles.push(existing!);
            initialListPayload.push(existing!);
        }
    }

    // Notify UI of initial status (some Syncing, some Idle)
    onProgress({ type: 'INITIAL_LIST', files: initialListPayload });

    // 5. Restore Index for Unchanged Files
    for (const file of unchangedFiles) {
        await fileSearchService.restoreIndex(client.id, file);
    }

    // 6. Process New/Modified/Stale Files
    const batchSize = 5;
    const finalUpdates: Partial<SyncedFile>[] = [];

    for (let i = 0; i < filesToProcess.length; i += batchSize) {
        const batch = filesToProcess.slice(i, i + batchSize);

        const processedBatch = await Promise.all(batch.map(async (fileMeta) => {
            let finalFileObject: FileObject;
            
            try {
                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Downloading content...' }});
                
                let content = '';
                if (fileMeta.source === 'GOOGLE_DRIVE') {
                    content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
                }

                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Analyzing & Indexing...' }});
                
                const fileData = { ...fileMeta, content };
                finalFileObject = await fileSearchService.indexSingleFile(client!, fileData, settings.file_search_service_api_key);
                finalFileObject.statusMessage = 'Successfully synced.';

            } catch (error) {
                 console.error(`Error processing ${fileMeta.name}:`, error);
                 finalFileObject = {
                     ...fileMeta,
                     content: '',
                     summary: '',
                     status: 'FAILED',
                     statusMessage: error instanceof Error ? error.message : 'Processing failed'
                 };
            }
            
            // Prepare payload for DB Upsert
            const updatePayload = {
                ...finalFileObject,
                last_synced_at: new Date().toISOString(),
                id: fileMeta.existingId, // Use existing ID if we have it (Update), otherwise undefined (Insert)
                client_id: clientId
            };

            onProgress({ type: 'FILE_UPDATE', update: { source_item_id: finalFileObject.id, status: finalFileObject.status, status_message: finalFileObject.statusMessage, type: finalFileObject.type, source_modified_at: finalFileObject.source_modified_at }});
            return updatePayload;
        }));

        finalUpdates.push(...processedBatch.map(f => ({
             client_id: clientId,
             source_item_id: f.id,
             name: f.name,
             status: f.status,
             status_message: f.statusMessage,
             type: f.type,
             source: f.source,
             summary: f.summary,
             last_synced_at: new Date().toISOString(),
             source_modified_at: f.source_modified_at,
             id: f.id // Pass the uuid so DB knows which row to update
        })));
    }

    if (finalUpdates.length > 0) {
        await databaseService.updateClientFiles(clientId, finalUpdates);
    }
    
    const updatedClient = await databaseService.getClientById(clientId);
    if (!updatedClient) throw new Error("Failed to reload client after sync.");

    return { client: updatedClient };
  },

  syncSingleFile: async (clientId: string, file: SyncedFile): Promise<{ client: Client }> => {
      const settings = await databaseService.getSettings();
      let client = await databaseService.getClientById(clientId);
      if (!client || !settings.file_search_service_api_key) throw new Error("Configuration error.");

      // Manual single file sync - we don't delete, we just update.
      
      try {
          let content = '';
          let updatedMeta = { 
              name: file.name, 
              source_modified_at: file.source_modified_at || new Date().toISOString(),
              mimeType: file.type === 'image' ? 'image/jpeg' : 'application/pdf'
          };

          if (file.source === 'GOOGLE_DRIVE') {
             try {
                const driveFiles = await googleDriveService.getListOfFiles(client.google_drive_folder_url!);
                const currentMeta = driveFiles.find(f => f.id === file.source_item_id);
                if (currentMeta) {
                    updatedMeta = {
                        name: currentMeta.name,
                        source_modified_at: currentMeta.modifiedTime,
                        mimeType: currentMeta.mimeType
                    };
                    content = await googleDriveService.getFileContent(file.source_item_id, currentMeta.mimeType);
                } else {
                     console.log("File not found on drive, identifying as deleted.");
                     const updatedClient = await databaseService.getClientById(clientId);
                     return { client: updatedClient! };
                }
             } catch (error: any) {
                 throw error;
             }
          }

          const fileData: Omit<FileObject, 'summary' | 'status' | 'statusMessage'> = {
              id: file.source_item_id,
              name: updatedMeta.name,
              type: file.type,
              mimeType: updatedMeta.mimeType,
              source: file.source,
              source_modified_at: updatedMeta.source_modified_at,
              content: content
          };

          const processed = await fileSearchService.indexSingleFile(client!, fileData, settings.file_search_service_api_key);

          const updatePayload: Partial<SyncedFile> = {
              id: file.id, // Update in place
              client_id: clientId,
              source_item_id: file.source_item_id,
              name: processed.name,
              status: processed.status,
              status_message: 'Manual sync completed successfully.',
              summary: processed.summary,
              last_synced_at: new Date().toISOString(),
              source_modified_at: processed.source_modified_at,
              type: processed.type,
              source: processed.source
          };

          await databaseService.updateClientFiles(clientId, [updatePayload]);

      } catch (error) {
          console.error("Single sync failed:", error);
          await databaseService.updateClientFiles(clientId, [{
              id: file.id,
              client_id: clientId,
              source_item_id: file.source_item_id,
              name: file.name,
              status: 'FAILED',
              status_message: error instanceof Error ? error.message : 'Failed',
              type: file.type,
              source: file.source
          }]);
      }

      const updatedClient = await databaseService.getClientById(clientId);
      return { client: updatedClient! };
  }
};
