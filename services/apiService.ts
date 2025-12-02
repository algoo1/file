
import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile, Tag } from '../types.ts';

// User Requirement: Re-upload/Refresh files every 46 hours.
const REFRESH_INTERVAL_HOURS = 46;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
   * IMMEDIATELY records a newly uploaded file into the database.
   * This ensures the user sees the file as "Uploaded" without waiting for the sync loop.
   */
  registerUploadedFile: async (clientId: string, fileData: { source_item_id: string, name: string, type: 'image' }) => {
      const newFile: Partial<SyncedFile> = {
          client_id: clientId,
          source_item_id: fileData.source_item_id,
          name: fileData.name,
          type: fileData.type,
          source: 'GOOGLE_DRIVE',
          status: 'IDLE', // Mark as IDLE so syncDataSource picks it up for indexing
          status_message: 'Upload completed. Waiting for indexing...',
          source_modified_at: new Date().toISOString(),
          created_at: new Date().toISOString()
      };
      await databaseService.updateClientFiles(clientId, [newFile]);
  },

  /**
   * Performs a Smart Sync with 46-Hour Refresh Rule.
   * 
   * Logic:
   * 1. Sync existing item from Drive.
   * 2. Verify if it was uploaded/indexed (Status=COMPLETED).
   * 3. If uploaded & fresh -> Mark Green (Done).
   * 4. If not uploaded or IDLE -> Process (Index).
   * 5. If Modified (Row deleted/changed) -> Re-process from scratch.
   * 6. If > 46 Hours -> Re-process from scratch.
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

    // 2. Database State Comparison
    const relevantExistingFiles = client.synced_files;
    const existingFilesMap = new Map(relevantExistingFiles.map(f => [f.source_item_id, f]));
    const sourceIds = new Set(allSourceFilesMeta.map(f => f.id));
    
    // 3. Handle Deletions (Cleanup old files from DB that no longer exist on Drive)
    const filesToDelete = relevantExistingFiles.filter(f => !sourceIds.has(f.source_item_id));
    if (filesToDelete.length > 0) {
        await databaseService.deleteClientFiles(filesToDelete.map(f => f.id));
        console.log(`Removed ${filesToDelete.length} obsolete files.`);
    }

    // 4. Determine Work (The "Brain" of the operation)
    const filesToProcess: (typeof allSourceFilesMeta[0] & { existingId?: string; created_at: string })[] = [];
    const unchangedFiles: SyncedFile[] = [];
    const initialListPayload: Partial<SyncedFile>[] = [];

    for (const sourceFile of allSourceFilesMeta) {
        const existing = existingFilesMap.get(sourceFile.id);
        
        let shouldProcess = false;
        let reason = '';
        
        // Preserve original upload time if exists, otherwise it's now.
        const originalUploadTime = existing?.created_at || new Date().toISOString();
        
        if (!existing) {
            // New File -> Upload/Index
            shouldProcess = true;
            reason = 'New file detected.';
        } else {
            // Existing File Logic
            const driveTime = sourceFile.source_modified_at ? new Date(sourceFile.source_modified_at).getTime() : 0;
            const dbTime = existing.source_modified_at ? new Date(existing.source_modified_at).getTime() : 0;
            const lastSyncTime = existing.last_synced_at ? new Date(existing.last_synced_at).getTime() : 0;
            const now = Date.now();
            
            // Check 1: Modification (Drift tolerance: 1000ms)
            // If Drive time is significantly different from what we stored, content changed.
            const isModified = Math.abs(driveTime - dbTime) > 1000;

            // Check 2: 46-Hour Periodic Refresh
            const isStale = (now - lastSyncTime) > REFRESH_INTERVAL_MS;

            // Check 3: Retry Pending/Failed
            // Note: We retry 'IDLE' or 'FAILED'. We do NOT interrupt 'SYNCING' to avoid double-processing if the user spams refresh.
            const isPending = existing.status === 'IDLE' || existing.status === 'FAILED';

            if (forceFullResync) {
                shouldProcess = true;
                reason = 'Forced manual resync.';
            } else if (isModified) {
                shouldProcess = true;
                reason = 'File modified on Google Drive. Re-indexing...';
            } else if (isStale) {
                shouldProcess = true;
                reason = `Periodic refresh (${REFRESH_INTERVAL_HOURS}h passed).`;
            } else if (isPending) {
                shouldProcess = true;
                reason = existing.status === 'FAILED' ? 'Retrying failed file.' : 'Processing new upload.';
            }
        }

        if (shouldProcess) {
            filesToProcess.push({ 
                ...sourceFile, 
                existingId: existing?.id,
                created_at: originalUploadTime 
            });
            
            initialListPayload.push({
                source_item_id: sourceFile.id,
                name: sourceFile.name,
                status: 'SYNCING', 
                type: sourceFile.type,
                source: sourceFile.source,
                source_modified_at: sourceFile.source_modified_at,
                id: existing?.id, 
                status_message: reason,
                created_at: originalUploadTime,
                updated_at: new Date().toISOString()
            });
        } else {
            // Unchanged - Do NOT re-sync
            // This item is "Green Checked" implicitly by having status=COMPLETED and not being in the process list
            unchangedFiles.push(existing!);
            initialListPayload.push(existing!);
        }
    }

    // Notify UI
    onProgress({ type: 'INITIAL_LIST', files: initialListPayload });

    // 5. Process Queue
    const batchSize = 1; // Keep to 1 to respect Rate Limits
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

                if (!content && fileMeta.type !== 'image') {
                     throw new Error("File content is empty.");
                }

                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Analyzing content...' }});
                
                // Rate limit buffer
                await delay(6000); 

                const fileData = { ...fileMeta, content };
                // AI Summary
                finalFileObject = await fileSearchService.indexSingleFile(client!, fileData, settings.file_search_service_api_key);
                
                if (finalFileObject.status === 'COMPLETED') {
                     finalFileObject.statusMessage = 'Successfully synced.';
                }

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
            
            const updatePayload = {
                ...finalFileObject,
                status_message: finalFileObject.statusMessage,
                last_synced_at: new Date().toISOString(), 
                // CRITICAL: Explicitly set source_modified_at to matches Drive's time to prevent infinite loops
                source_modified_at: fileMeta.source_modified_at, 
                created_at: fileMeta.created_at, 
                id: fileMeta.existingId,
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
             status_message: f.status_message,
             type: f.type,
             source: f.source,
             summary: f.summary,
             last_synced_at: f.last_synced_at,
             source_modified_at: f.source_modified_at,
             created_at: f.created_at,
             id: f.id
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
                     console.log("File not found on drive.");
                     return { client: client! };
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
              id: file.id,
              client_id: clientId,
              source_item_id: file.source_item_id,
              name: processed.name,
              status: processed.status,
              status_message: processed.status === 'COMPLETED' ? 'Manual sync completed.' : processed.statusMessage,
              summary: processed.summary,
              last_synced_at: new Date().toISOString(), // Updates last sync time
              source_modified_at: processed.source_modified_at,
              type: processed.type,
              source: processed.source,
              created_at: file.created_at 
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
