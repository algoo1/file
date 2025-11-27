
import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile, Tag } from '../types.ts';

// This service is the main public API for the UI.
// It orchestrates calls to the other services (database, google, file search).
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
   * Checks modification times and only processes (fetch content + AI summary) files that have changed or are new.
   * Unchanged files are re-indexed using the data already in the database.
   * Missing files are deleted from the database.
   * 
   * @param limitSource Optional. If provided, checks only this source (Only 'GOOGLE_DRIVE' supported now).
   * @param forceFullResync Optional. If true, ignores modification times and re-processes all files with AI.
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

    // Check configuration
    const isDriveConfigured = !!client.google_drive_folder_url && settings.is_google_drive_connected;

    if (!isDriveConfigured) {
       throw new Error("Google Drive is not configured for this client.");
    }
    
    // 1. Fetch Metadata from Sources
    let allSourceFilesMeta: (Omit<FileObject, 'content' | 'summary' | 'status' | 'statusMessage'>)[] = [];

    if (isDriveConfigured) {
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
            throw e; // Propagate error for UI feedback
        }
    }

    // 2. Determine Work to be Done (Smart Diff)
    // Because the index is in-memory, we must clear it and rebuild it every time we "Sync" or reload.
    await fileSearchService.clearIndexForClient(clientId);
    
    // Get existing files.
    const relevantExistingFiles = client.synced_files;
    
    const existingFilesMap = new Map(relevantExistingFiles.map(f => [f.source_item_id, f]));
    const sourceIds = new Set(allSourceFilesMeta.map(f => f.id));
    
    // 2a. Detect Deletions (Files no longer in source)
    const filesToDelete = relevantExistingFiles.filter(f => !sourceIds.has(f.source_item_id));
    if (filesToDelete.length > 0) {
        await databaseService.deleteClientFiles(filesToDelete.map(f => f.id));
        console.log(`Deleted ${filesToDelete.length} files that are no longer in source.`);
    }

    // 2b. Detect New and Modified Files
    const filesToProcess: typeof allSourceFilesMeta = [];
    const unchangedFiles: SyncedFile[] = [];
    const initialListPayload: Partial<SyncedFile>[] = [];
    const modifiedFileIdsToDelete: string[] = [];

    for (const sourceFile of allSourceFilesMeta) {
        const existing = existingFilesMap.get(sourceFile.id);
        
        let isModified = false;
        const isNew = !existing;
        
        if (existing) {
            if (forceFullResync) {
                isModified = true;
            }
            // If previous sync failed, try again
            else if (existing.status === 'FAILED') {
                isModified = true;
            } 
            // Check timestamp
            else if (sourceFile.source_modified_at && existing.source_modified_at) {
                // If timestamp strings differ, update. 
                if (sourceFile.source_modified_at !== existing.source_modified_at) {
                    const newTime = new Date(sourceFile.source_modified_at).getTime();
                    const oldTime = new Date(existing.source_modified_at).getTime();
                    if (!isNaN(newTime) && !isNaN(oldTime)) {
                         // 1 second tolerance
                        if (Math.abs(newTime - oldTime) > 1000) isModified = true;
                    } else {
                        isModified = true;
                    }
                }
            } 
            // Fallback if no timestamp existed before
            else if (!existing.source_modified_at) {
                isModified = true;
            }
        } else {
             isModified = true; // New file
        }

        if (isNew || isModified) {
            // New Logic: "This file will be deleted from the data ... uploaded again with modifications"
            // If modified, queue it for deletion so we get a clean slate (fresh insert, fresh index).
            if (isModified && existing) {
                modifiedFileIdsToDelete.push(existing.id);
            }

            filesToProcess.push(sourceFile);
            
            // Generate a descriptive status message
            let statusMsg = 'Pending sync...';
            if (forceFullResync && !isNew) statusMsg = 'Forced re-processing...';
            else if (isNew) statusMsg = 'New file detected.';
            else if (isModified) {
                statusMsg = `Content modified. Cleaning old data and re-importing...`;
            }

            initialListPayload.push({
                source_item_id: sourceFile.id,
                name: sourceFile.name,
                status: 'SYNCING', // Always Syncing since we are re-processing
                type: sourceFile.type,
                source: sourceFile.source,
                source_modified_at: sourceFile.source_modified_at,
                // If we are deleting the old record, do not pass the old ID.
                id: (isModified && existing) ? undefined : existing?.id, 
                status_message: statusMsg
            });
        } else {
            // Unchanged: Keep existing data and prepare to restore index
            unchangedFiles.push(existing!);
            initialListPayload.push(existing!);
        }
    }

    // Execute deletion of modified files to ensure "Delete then Upload" behavior
    if (modifiedFileIdsToDelete.length > 0) {
        await databaseService.deleteClientFiles(modifiedFileIdsToDelete);
        console.log(`Deleted ${modifiedFileIdsToDelete.length} modified files from database to ensure fresh sync.`);
    }

    // Notify UI about the state of files before we start processing
    onProgress({ type: 'INITIAL_LIST', files: initialListPayload });

    // 3. Restore Index for Unchanged Files
    // This avoids expensive Gemini calls for files we already summarized.
    for (const file of unchangedFiles) {
        await fileSearchService.restoreIndex(client.id, file);
    }

    // 4. Process Changed/New Files (Fetch -> Gemini -> Index)
    const batchSize = 5;
    const finalUpdates: Partial<SyncedFile>[] = [];

    for (let i = 0; i < filesToProcess.length; i += batchSize) {
        const batch = filesToProcess.slice(i, i + batchSize);

        const processedBatch = await Promise.all(batch.map(async (fileMeta) => {
            let finalFileObject: FileObject;
            // Since we deleted modified files, we treat everything here as a new insert (id=undefined).
            
            try {
                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Fetching content...' }});
                
                let content = '';
                if (fileMeta.source === 'GOOGLE_DRIVE') {
                    content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
                }

                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Processing with AI...' }});
                
                const fileData = { ...fileMeta, content };
                finalFileObject = await fileSearchService.indexSingleFile(client!, fileData, settings.file_search_service_api_key);
                
                // Add success message
                finalFileObject.statusMessage = 'File synced successfully.';

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
                last_synced_at: new Date().toISOString(),
                id: undefined, // Always undefined to force INSERT
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
             id: undefined // Force INSERT
        })));
    }

    // 5. Update Database (Upsert/Insert)
    if (finalUpdates.length > 0) {
        await databaseService.updateClientFiles(clientId, finalUpdates);
    }
    
    // 6. Return updated client
    const updatedClient = await databaseService.getClientById(clientId);
    if (!updatedClient) throw new Error("Failed to reload client after sync.");

    return { client: updatedClient };
  },

  /**
   * Syncs a single file manually.
   * Forces a re-download and re-summarization regardless of timestamps.
   */
  syncSingleFile: async (
    clientId: string,
    file: SyncedFile
  ): Promise<{ client: Client }> => {
      const settings = await databaseService.getSettings();
      let client = await databaseService.getClientById(clientId);
      if (!client || !settings.file_search_service_api_key) throw new Error("Configuration error.");

      // CLEAN SLATE: Delete the existing file first.
      await databaseService.deleteClientFiles([file.id]);

      try {
          let content = '';
          // We need fresh metadata (like modified time) first
          let updatedMeta = { 
              name: file.name, 
              source_modified_at: file.source_modified_at || new Date().toISOString(),
              mimeType: file.type === 'image' ? 'image/jpeg' : 'application/pdf' // Default fallback
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
                    // Drive file missing from list. Since we deleted it from DB, we just stop here.
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
              // No ID provided, so it inserts a new record
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
          // Re-insert an error record since we deleted the original
          await databaseService.updateClientFiles(clientId, [{
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

// Helper to format date consistent with UI
const formatDate = (isoString?: string) => {
    if (!isoString) return '-';
    try {
        return new Date(isoString).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return isoString;
    }
};
