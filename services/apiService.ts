
import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile, Tag } from '../types.ts';

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

  connectGoogleDrive: async (creds: { apiKey: string, clientId: string, clientSecret: string }) => {
    try {
        const refreshToken = await googleDriveService.connect(creds.apiKey, creds.clientId, creds.clientSecret);
        await databaseService.saveSettings({ 
            is_google_drive_connected: true,
            google_api_key: creds.apiKey,
            google_client_id: creds.clientId,
            google_client_secret: creds.clientSecret,
            google_refresh_token: refreshToken
        });
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

  registerUploadedFile: async (clientId: string, fileData: { source_item_id: string, name: string, type: 'image' }) => {
      const newFile: Partial<SyncedFile> = {
          client_id: clientId,
          source_item_id: fileData.source_item_id,
          name: fileData.name,
          type: fileData.type,
          source: 'GOOGLE_DRIVE',
          status: 'IDLE',
          status_message: 'Upload completed. Waiting for indexing...',
          source_modified_at: new Date().toISOString(),
          created_at: new Date().toISOString()
      };
      await databaseService.updateClientFiles(clientId, [newFile]);
  },

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
    if (!client.google_drive_folder_url || !settings.is_google_drive_connected) {
       throw new Error("Google Drive is not configured.");
    }

    let performFullSync = !client.drive_sync_token || forceFullResync;

    // --- STRATEGY B: INCREMENTAL SYNC (Try first if we have a token) ---
    if (!performFullSync) {
        try {
            // console.log("Checking for changes since last token...");
            const { changes, newStartPageToken } = await googleDriveService.getChanges(client.drive_sync_token!);

            if (changes.length > 0) {
                console.log(`Found ${changes.length} changes.`);
                const folderId = googleDriveService.getFolderIdFromUrl(client.google_drive_folder_url);

                const idsToDelete: string[] = [];
                const filesToUpdate: any[] = [];

                for (const change of changes) {
                    if (change.removed || (change.file && change.file.trashed)) {
                        idsToDelete.push(change.fileId);
                        continue;
                    }

                    const file = change.file;
                    if (file && 
                       (file.mimeType.includes('pdf') || file.mimeType.includes('spreadsheet') || file.mimeType.includes('image') || file.mimeType.includes('document'))
                    ) {
                         const getFileType = (mimeType: string): 'pdf' | 'sheet' | 'image' => {
                            if (mimeType.includes('spreadsheet')) return 'sheet';
                            if (mimeType.startsWith('image/')) return 'image';
                            return 'pdf'; 
                        };
                        filesToUpdate.push({
                            id: file.id,
                            name: file.name,
                            mimeType: file.mimeType,
                            type: getFileType(file.mimeType),
                            source: 'GOOGLE_DRIVE',
                            source_modified_at: file.modifiedTime
                        });
                    }
                }

                // 1. Process Deletions
                if (idsToDelete.length > 0) {
                    console.log("Removing deleted files:", idsToDelete);
                    await databaseService.deleteClientFilesBySourceId(clientId, idsToDelete);
                }

                // 2. Process Updates/Adds
                for (const fileMeta of filesToUpdate) {
                     try {
                        onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Detected change. Downloading...' }});
                        const content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
                        
                        onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Re-analyzing...' }});
                        const fileData = { ...fileMeta, content };
                        const processed = await fileSearchService.indexSingleFile(client, fileData, settings.file_search_service_api_key);
                        
                        const existing = client.synced_files.find(f => f.source_item_id === fileMeta.id);

                        await databaseService.updateClientFiles(clientId, [{
                            id: existing?.id,
                            client_id: clientId,
                            source_item_id: processed.id,
                            name: processed.name,
                            status: processed.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
                            status_message: processed.statusMessage || 'Updated via Sync.',
                            summary: processed.summary,
                            content: content, 
                            type: processed.type,
                            source: 'GOOGLE_DRIVE',
                            last_synced_at: new Date().toISOString(),
                            source_modified_at: processed.source_modified_at,
                            created_at: existing?.created_at || new Date().toISOString(),
                        }]);
                        onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'COMPLETED' }});

                    } catch (error) {
                        console.error(`Incremental Sync Error ${fileMeta.name}:`, error);
                        await databaseService.updateClientFiles(clientId, [{
                            client_id: clientId, source_item_id: fileMeta.id, status: 'FAILED', status_message: String(error)
                        }]);
                    }
                }
            }

            // Save new token
            await databaseService.updateClient(clientId, { drive_sync_token: newStartPageToken });

        } catch (error: any) {
            if (error.message === 'INVALID_SYNC_TOKEN') {
                console.warn("Sync token invalid/expired. Falling back to Full Sync.");
                performFullSync = true;
                await databaseService.updateClient(clientId, { drive_sync_token: null });
            } else {
                throw error; // Re-throw real errors
            }
        }
    }

    // --- STRATEGY A: INITIAL/FALLBACK FULL SYNC ---
    if (performFullSync) {
        console.log("Starting Full Sync...");
        const driveFilesMeta = await googleDriveService.getListOfFiles(client.google_drive_folder_url!);
        
        // 1. Get a baseline token for FUTURE changes
        const startPageToken = await googleDriveService.getStartPageToken();
        await databaseService.updateClient(clientId, { drive_sync_token: startPageToken });

        const getFileType = (mimeType: string): 'pdf' | 'sheet' | 'image' => {
            if (mimeType.includes('spreadsheet')) return 'sheet';
            if (mimeType.startsWith('image/')) return 'image';
            return 'pdf'; 
        };

        const filesToProcess = driveFilesMeta.map(f => ({ 
            id: f.id, 
            name: f.name, 
            mimeType: f.mimeType, 
            type: getFileType(f.mimeType), 
            source: 'GOOGLE_DRIVE' as const,
            source_modified_at: f.modifiedTime,
        }));
        
        // Clean up deletions based on this full list
        const existingFilesMap = new Map(client.synced_files.map(f => [f.source_item_id, f]));
        const sourceIds = new Set(filesToProcess.map(f => f.id));
        const filesToDelete = client.synced_files.filter(f => !sourceIds.has(f.source_item_id));
        if (filesToDelete.length > 0) {
            await databaseService.deleteClientFiles(filesToDelete.map(f => f.id));
        }

        const reallyNeedProcessing = filesToProcess.filter(f => {
             const existing = existingFilesMap.get(f.id);
             return !existing || existing.status === 'FAILED';
        });

        for (const fileMeta of reallyNeedProcessing) {
            try {
                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Downloading...' }});
                
                const content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
                
                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Analyzing...' }});
                await delay(1000);

                const fileData = { ...fileMeta, content };
                const processed = await fileSearchService.indexSingleFile(client, fileData, settings.file_search_service_api_key);
                
                await databaseService.updateClientFiles(clientId, [{
                    client_id: clientId,
                    source_item_id: processed.id,
                    name: processed.name,
                    status: processed.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
                    status_message: processed.statusMessage || 'Synced.',
                    summary: processed.summary,
                    content: content, 
                    type: processed.type,
                    source: processed.source,
                    last_synced_at: new Date().toISOString(),
                    source_modified_at: processed.source_modified_at,
                    created_at: new Date().toISOString(),
                }]);
                 onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'COMPLETED' }});

            } catch (error) {
                console.error(`Full Sync Error ${fileMeta.name}:`, error);
                await databaseService.updateClientFiles(clientId, [{
                    client_id: clientId, source_item_id: fileMeta.id, status: 'FAILED', status_message: String(error)
                }]);
            }
        }
    } 
    
    const updatedClient = await databaseService.getClientById(clientId);
    return { client: updatedClient! };
  },

  syncSingleFile: async (clientId: string, file: SyncedFile): Promise<{ client: Client }> => {
      const settings = await databaseService.getSettings();
      let client = await databaseService.getClientById(clientId);
      if (!client || !settings.file_search_service_api_key) throw new Error("Configuration error.");
      
      try {
           const driveFiles = await googleDriveService.getListOfFiles(client.google_drive_folder_url!);
           const currentMeta = driveFiles.find(f => f.id === file.source_item_id);
           if(!currentMeta) throw new Error("File not found on Drive.");
           
           const content = await googleDriveService.getFileContent(file.source_item_id, currentMeta.mimeType);
           const processed = await fileSearchService.indexSingleFile(client!, {
               ...currentMeta, 
               content, 
               type: file.type, 
               source: 'GOOGLE_DRIVE' 
           }, settings.file_search_service_api_key);

           await databaseService.updateClientFiles(clientId, [{
               ...processed,
               client_id: clientId,
               source_item_id: file.source_item_id,
               status: processed.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
               status_message: 'Manual sync completed.',
               last_synced_at: new Date().toISOString(),
               source_modified_at: processed.source_modified_at,
               summary: processed.summary,
               content: content, 
               id: file.id
           }]);
      } catch(e) {
           await databaseService.updateClientFiles(clientId, [{
               id: file.id, client_id: clientId, source_item_id: file.source_item_id, status: 'FAILED', status_message: String(e)
           }]);
      }
      return { client: (await databaseService.getClientById(clientId))! };
  }
};
