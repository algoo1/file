import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { airtableService } from './airtableService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile, Tag } from '../types.ts';

// This service is the main public API for the UI.
// It orchestrates calls to the other services (database, google, airtable, file search).
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
   */
  syncDataSource: async (
    clientId: string, 
    onProgress: (event: { type: 'INITIAL_LIST', files: Partial<SyncedFile>[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { source_item_id: string } }) => void
  ): Promise<{ client: Client }> => {
    let client = await databaseService.getClientById(clientId);
    const settings = await databaseService.getSettings();

    if (!client) throw new Error("Client not found.");
    if (!settings.file_search_service_api_key) throw new Error("File Search Service API Key is not set.");

    const isDriveConfigured = !!client.google_drive_folder_url && settings.is_google_drive_connected;
    let isAirtableConfigured = (!!client.airtable_api_key || !!client.airtable_access_token) && !!client.airtable_base_id && !!client.airtable_table_id;

    if (!isDriveConfigured && !isAirtableConfigured) {
      throw new Error("No data source is configured for this client.");
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
        }
    }

    if (isAirtableConfigured) {
      try {
        const { newTokensToSave } = await airtableService.getAuthToken(client, settings);
        if (newTokensToSave) {
          client = await databaseService.updateClient(client.id, newTokensToSave);
        }
        const airtableRecordsMeta = await airtableService.getRecords(client, settings);
        allSourceFilesMeta.push(...airtableRecordsMeta.map(r => ({ 
            id: r.id, 
            name: r.name, 
            type: 'record' as const, 
            source: 'AIRTABLE' as const, 
            mimeType: 'application/json',
            source_modified_at: r.createdTime // Airtable doesn't easily give modified time without field mapping, using created as base
        })));
      } catch (authError) {
          console.error("Airtable error:", authError);
      }
    }

    // 2. Determine Work to be Done (Smart Diff)
    const filesToProcess: typeof allSourceFilesMeta = [];
    const unchangedFiles: SyncedFile[] = [];
    
    // Because the index is in-memory, we must clear it and rebuild it every time we "Sync" or reload.
    await fileSearchService.clearIndexForClient(clientId);
    
    const existingFilesMap = new Map(client.synced_files.map(f => [f.source_item_id, f]));
    const initialListPayload: Partial<SyncedFile>[] = [];

    for (const sourceFile of allSourceFilesMeta) {
        const existing = existingFilesMap.get(sourceFile.id);
        
        let isModified = false;
        const isNew = !existing;
        
        if (existing) {
            // If previous sync failed, try again
            if (existing.status === 'FAILED') {
                isModified = true;
            } 
            // Check timestamp
            else if (sourceFile.source_modified_at && existing.source_modified_at) {
                const newTime = new Date(sourceFile.source_modified_at).getTime();
                const oldTime = new Date(existing.source_modified_at).getTime();
                if (newTime > oldTime) {
                    isModified = true;
                }
            } 
            // Fallback if no timestamp existed before
            else if (!existing.source_modified_at) {
                isModified = true;
            }
        }

        if (isNew || isModified) {
            filesToProcess.push(sourceFile);
            initialListPayload.push({
                source_item_id: sourceFile.id,
                name: sourceFile.name,
                status: existing ? 'SYNCING' : 'IDLE',
                type: sourceFile.type,
                source: sourceFile.source,
                source_modified_at: sourceFile.source_modified_at,
                id: existing?.id // Preserve ID if update
            });
        } else {
            // Unchanged: Keep existing data and prepare to restore index
            unchangedFiles.push(existing!);
            initialListPayload.push(existing!);
        }
    }

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
            const existingId = existingFilesMap.get(fileMeta.id)?.id;

            try {
                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Fetching content...' }});
                
                let content = '';
                if (fileMeta.source === 'GOOGLE_DRIVE') {
                    content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
                } else if (fileMeta.source === 'AIRTABLE') {
                    content = await airtableService.getRecordContent(client!, settings, fileMeta.id);
                }

                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Processing with AI...' }});
                
                const fileData = { ...fileMeta, content };
                finalFileObject = await fileSearchService.indexSingleFile(client!, fileData, settings.file_search_service_api_key);
                
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
                id: existingId,
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
             id: (f as any).id // uuid from DB
        })));
    }

    // 5. Update Database (Upsert)
    if (finalUpdates.length > 0) {
        await databaseService.updateClientFiles(clientId, finalUpdates);
    }
    
    // 6. Return updated client
    const updatedClient = await databaseService.getClientById(clientId);
    if (!updatedClient) throw new Error("Failed to reload client after sync.");

    return { client: updatedClient };
  },

  /**
   * Syncs a single file or record manually.
   * Forces a re-download and re-summarization regardless of timestamps.
   */
  syncSingleFile: async (
    clientId: string,
    file: SyncedFile
  ): Promise<{ client: Client }> => {
      const settings = await databaseService.getSettings();
      let client = await databaseService.getClientById(clientId);
      if (!client || !settings.file_search_service_api_key) throw new Error("Configuration error.");

      // Update status to syncing in DB/UI immediately
      await databaseService.updateClientFiles(clientId, [{ ...file, status: 'SYNCING', status_message: 'Starting single file sync...' }]);
      
      try {
          let content = '';
          // We need fresh metadata (like modified time) first
          let updatedMeta = { 
              name: file.name, 
              source_modified_at: file.source_modified_at || new Date().toISOString(),
              mimeType: file.type === 'record' ? 'application/json' : 'application/pdf' // Default
          };

          if (file.source === 'GOOGLE_DRIVE') {
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
                 throw new Error("File not found in Google Drive folder. It may have been deleted.");
             }
          } else if (file.source === 'AIRTABLE') {
             try {
                 const { newTokensToSave } = await airtableService.getAuthToken(client, settings);
                 if (newTokensToSave) client = await databaseService.updateClient(client.id, newTokensToSave);
             } catch(e) { /* Ignore auth error here, fetch will catch */ }
             
             // For manual sync, we assume we want the latest content regardless of timestamp.
             content = await airtableService.getRecordContent(client!, settings, file.source_item_id);
             updatedMeta.source_modified_at = new Date().toISOString(); // Update timestamp to now to indicate recent check
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
              id: file.id, // UUID
              client_id: clientId,
              source_item_id: file.source_item_id,
              name: processed.name,
              status: processed.status,
              status_message: processed.statusMessage,
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
              status: 'FAILED',
              status_message: error instanceof Error ? error.message : 'Failed'
          }]);
      }

      const updatedClient = await databaseService.getClientById(clientId);
      return { client: updatedClient! };
  }
};