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

  syncDataSource: async (
    clientId: string, 
    onProgress: (event: { type: 'INITIAL_LIST', files: Partial<SyncedFile>[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { source_item_id: string } }) => void
  ): Promise<{ client: Client }> => {
    const client = await databaseService.getClientById(clientId);
    const settings = await databaseService.getSettings();

    if (!client) throw new Error("Client not found.");
    if (!settings.file_search_service_api_key) throw new Error("File Search Service API Key is not set.");

    const isDriveConfigured = !!client.google_drive_folder_url && settings.is_google_drive_connected;
    const isAirtableConfigured = (!!client.airtable_api_key || !!client.airtable_access_token) && !!client.airtable_base_id && !!client.airtable_table_id;

    if (!isDriveConfigured && !isAirtableConfigured) {
      throw new Error("No data source is configured for this client.");
    }
    
    let allSourceFilesMeta: (Omit<FileObject, 'content' | 'summary' | 'status' | 'statusMessage'>)[] = [];

    // 1. Fetch metadata from all configured sources
    if (isDriveConfigured) {
        const driveFilesMeta = await googleDriveService.getListOfFiles(client.google_drive_folder_url!);
        const getFileType = (mimeType: string): 'pdf' | 'sheet' | 'image' => {
            if (mimeType.includes('spreadsheet')) return 'sheet';
            if (mimeType.startsWith('image/')) return 'image';
            return 'pdf'; // Default for PDF, GDoc, text
        };
        allSourceFilesMeta.push(...driveFilesMeta.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, type: getFileType(f.mimeType), source: 'GOOGLE_DRIVE' as const })));
    }

    if (isAirtableConfigured) {
        const airtableRecordsMeta = await airtableService.getRecords(client, settings.airtable_client_id);
        allSourceFilesMeta.push(...airtableRecordsMeta.map(r => ({ id: r.id, name: r.name, type: 'record' as const, source: 'AIRTABLE' as const, mimeType: 'application/json' })));
    }
    
    // 2. Prepare initial UI state and clear the old search index
    const initialSyncedFiles: Partial<SyncedFile>[] = allSourceFilesMeta.map(f => ({
        source_item_id: f.id,
        name: f.name,
        status: 'IDLE',
        status_message: 'In queue...',
        type: f.type,
        source: f.source,
    }));

    onProgress({ type: 'INITIAL_LIST', files: initialSyncedFiles });
    await fileSearchService.clearIndexForClient(clientId);


    // 3. Process each file/record in parallel batches for speed
    const allProcessedFiles: FileObject[] = [];
    const batchSize = 5; // Process 5 items concurrently

    for (let i = 0; i < allSourceFilesMeta.length; i += batchSize) {
        const batch = allSourceFilesMeta.slice(i, i + batchSize);

        const processedBatch = await Promise.all(batch.map(async (fileMeta) => {
            let finalFileObject: FileObject;
            try {
                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'SYNCING', status_message: 'Fetching content...' }});
                
                let content = '';
                if (fileMeta.source === 'GOOGLE_DRIVE') {
                    content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
                } else if (fileMeta.source === 'AIRTABLE') {
                    content = await airtableService.getRecordContent(client, settings.airtable_client_id, fileMeta.id);
                }

                onProgress({ type: 'FILE_UPDATE', update: { source_item_id: fileMeta.id, status: 'INDEXING', status_message: 'Processing with AI...' }});
                
                const fileData = { ...fileMeta, content };
                
                finalFileObject = await fileSearchService.indexSingleFile(client, fileData, settings.file_search_service_api_key);
                
            } catch (error) {
                 console.error(`Critical error processing item ${fileMeta.name} (${fileMeta.id}):`, error);
                 finalFileObject = {
                     ...fileMeta,
                     content: '',
                     summary: '',
                     status: 'FAILED',
                     statusMessage: error instanceof Error ? error.message : 'A critical failure occurred during processing.'
                 };
            }
            
            onProgress({ type: 'FILE_UPDATE', update: { source_item_id: finalFileObject.id, status: finalFileObject.status, status_message: finalFileObject.statusMessage, type: finalFileObject.type }});
            return finalFileObject;
        }));

        allProcessedFiles.push(...processedBatch);
    }

    // 4. Update the client's file list in our database with the final state
    await databaseService.updateClientFiles(clientId, allProcessedFiles);
    
    // 5. Fetch the fully updated client to return to the UI
    const updatedClient = await databaseService.getClientById(clientId);
    if (!updatedClient) throw new Error("Failed to reload client after sync.");

    return { client: updatedClient };
  },

};