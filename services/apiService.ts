
import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile, Tag } from '../types.ts';

const REFRESH_INTERVAL_HOURS = 46;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
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
    
    // 1. Fetch Fresh Metadata from Drive
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
        throw e;
    }

    // 2. Database State Comparison
    const existingFilesMap = new Map(client.synced_files.map(f => [f.source_item_id, f]));
    const sourceIds = new Set(allSourceFilesMeta.map(f => f.id));
    
    // 3. Cleanup deletions
    const filesToDelete = client.synced_files.filter(f => !sourceIds.has(f.source_item_id));
    if (filesToDelete.length > 0) {
        await databaseService.deleteClientFiles(filesToDelete.map(f => f.id));
    }

    // 4. Identify Processable Files
    const filesToProcess: (typeof allSourceFilesMeta[0] & { existingId?: string; created_at: string })[] = [];
    const initialListPayload: Partial<SyncedFile>[] = [];

    for (const sourceFile of allSourceFilesMeta) {
        const existing = existingFilesMap.get(sourceFile.id);
        const originalUploadTime = existing?.created_at || new Date().toISOString();
        
        let shouldProcess = false;
        let reason = '';
        
        if (!existing) {
            shouldProcess = true;
            reason = 'New file found.';
        } else {
            // STRICT Time comparison: Ignore differences less than 5000ms (5s) to account for API clock drifts
            const driveTime = new Date(sourceFile.source_modified_at || 0).getTime();
            const dbTime = new Date(existing.source_modified_at || 0).getTime();
            const timeDiff = Math.abs(driveTime - dbTime);
            
            const isModified = timeDiff > 5000; 
            const isStale = (Date.now() - new Date(existing.last_synced_at || 0).getTime()) > REFRESH_INTERVAL_MS;
            const isPending = existing.status === 'IDLE' || existing.status === 'FAILED';
            const isBusy = existing.status === 'SYNCING' || existing.status === 'INDEXING';

            if (forceFullResync) {
                shouldProcess = true;
                reason = 'Forced resync.';
            } else if (isBusy) {
                // If it's currently syncing, DO NOT interrupt or re-add to queue
                shouldProcess = false; 
            } else if (isModified) {
                shouldProcess = true;
                reason = 'Content changed on Drive.';
            } else if (isStale) {
                shouldProcess = true;
                reason = 'Scheduled refresh.';
            } else if (isPending) {
                shouldProcess = true;
                reason = 'Retrying/Processing.';
            }
        }

        if (shouldProcess) {
            filesToProcess.push({ ...sourceFile, existingId: existing?.id, created_at: originalUploadTime });
            initialListPayload.push({
                source_item_id: sourceFile.id,
                name: sourceFile.name,
                status: 'SYNCING', 
                status_message: reason,
                type: sourceFile.type,
                source: sourceFile.source,
                source_modified_at: sourceFile.source_modified_at,
                id: existing?.id, 
                created_at: originalUploadTime,
                updated_at: new Date().toISOString()
            });
        } else {
            // Explicitly report as COMPLETED or current status to UI
            initialListPayload.push({
                 ...existing!,
                 status: existing!.status
            });
        }
    }

    onProgress({ type: 'INITIAL_LIST', files: initialListPayload });

    // 5. Execution Loop
    for (const fileMeta of filesToProcess) {
        try {
            onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Downloading...' }});
            
            let content = '';
            // Always download content for processing
            if (fileMeta.source === 'GOOGLE_DRIVE') {
                content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
            }

            onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Analyzing with AI...' }});
            await delay(2000); // Rate limit smoothing

            const fileData = { ...fileMeta, content };
            const processed = await fileSearchService.indexSingleFile(client!, fileData, settings.file_search_service_api_key);
            
            // Save success state AND CONTENT to Database
            await databaseService.updateClientFiles(clientId, [{
                client_id: clientId,
                source_item_id: processed.id,
                name: processed.name,
                status: processed.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
                status_message: processed.statusMessage || 'Synced.',
                summary: processed.summary,
                content: content, // SAVE FULL DATA
                type: processed.type,
                source: processed.source,
                last_synced_at: new Date().toISOString(),
                source_modified_at: processed.source_modified_at,
                created_at: fileMeta.created_at,
                id: fileMeta.existingId
            }]);

            onProgress({ type: 'FILE_UPDATE', update: { 
                source_item_id: processed.id, 
                status: processed.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED', 
                status_message: processed.statusMessage,
                content: content // Send content to UI immediately
            }});

        } catch (error) {
            console.error(`Sync error for ${fileMeta.name}:`, error);
            await databaseService.updateClientFiles(clientId, [{
                client_id: clientId,
                source_item_id: fileMeta.id,
                status: 'FAILED',
                status_message: String(error),
                source_modified_at: fileMeta.source_modified_at,
                id: fileMeta.existingId
            }]);
             onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'FAILED', status_message: 'Failed.' }});
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

           // SAVE FULL DATA
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
