import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { airtableService } from './airtableService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile } from '../types.ts';

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
        await databaseService.saveSettings({ isGoogleDriveConnected: true });
        return { connected: true };
    } catch (error) {
        await databaseService.saveSettings({ isGoogleDriveConnected: false });
        throw error;
    }
  },

  addClient: async (name: string) => {
    return await databaseService.addClient(name);
  },
  
  updateClient: async (id: string, updates: Partial<Omit<Client, 'id'>>) => {
      return await databaseService.updateClient(id, updates);
  },
  
  addTagToClient: async(clientId: string, tagName: string) => {
      return await databaseService.addTagToClient(clientId, tagName);
  },

  removeTagFromClient: async(clientId: string, tagId: string) => {
      return await databaseService.removeTagFromClient(clientId, tagId);
  },

  syncDataSource: async (
    clientId: string, 
    onProgress: (event: { type: 'INITIAL_LIST', files: SyncedFile[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { id: string } }) => void
  ) => {
    const client = await databaseService.getClientById(clientId);
    const settings = await databaseService.getSettings();

    if (!client) throw new Error("Client not found.");
    if (!settings.fileSearchServiceApiKey) throw new Error("File Search Service API Key is not set.");

    const isDriveConfigured = !!client.googleDriveFolderUrl && settings.isGoogleDriveConnected;
    const isAirtableConfigured = !!client.airtableApiKey && !!client.airtableBaseId && !!client.airtableTableId;

    if (!isDriveConfigured && !isAirtableConfigured) {
      throw new Error("No data source is configured for this client.");
    }
    
    let allSourceFilesMeta: (Omit<FileObject, 'content' | 'summary' | 'status' | 'statusMessage'>)[] = [];

    // 1. Fetch metadata from all configured sources
    if (isDriveConfigured) {
        const driveFilesMeta = await googleDriveService.getListOfFiles(client.googleDriveFolderUrl!);
        const getFileType = (mimeType: string): 'pdf' | 'sheet' | 'image' => {
            if (mimeType.includes('spreadsheet')) return 'sheet';
            if (mimeType.startsWith('image/')) return 'image';
            return 'pdf'; // Default for PDF, GDoc, text
        };
        allSourceFilesMeta.push(...driveFilesMeta.map(f => ({ ...f, type: getFileType(f.mimeType), source: 'GOOGLE_DRIVE' as const })));
    }

    if (isAirtableConfigured) {
        const airtableRecordsMeta = await airtableService.getRecords(client.airtableApiKey!, client.airtableBaseId!, client.airtableTableId!);
        allSourceFilesMeta.push(...airtableRecordsMeta.map(r => ({ ...r, type: 'record' as const, source: 'AIRTABLE' as const, mimeType: 'application/json' })));
    }
    
    // 2. Prepare initial UI state and clear the old search index
    const initialSyncedFiles: SyncedFile[] = allSourceFilesMeta.map(f => ({
        id: f.id,
        name: f.name,
        status: 'IDLE',
        statusMessage: 'In queue...',
        type: f.type,
        source: f.source,
    }));

    onProgress({ type: 'INITIAL_LIST', files: initialSyncedFiles });
    await fileSearchService.clearIndexForClient(clientId);


    // 3. Process each file/record sequentially
    const allProcessedFiles: FileObject[] = [];
    for (const fileMeta of allSourceFilesMeta) {
        let finalFileObject: FileObject;
        
        try {
            onProgress({ type: 'FILE_UPDATE', update: { id: fileMeta.id, status: 'SYNCING', statusMessage: 'Fetching content...' }});
            
            let content = '';
            if (fileMeta.source === 'GOOGLE_DRIVE') {
                content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);
            } else if (fileMeta.source === 'AIRTABLE') {
                content = await airtableService.getRecordContent(client.airtableApiKey!, client.airtableBaseId!, client.airtableTableId!, fileMeta.id);
            }

            onProgress({ type: 'FILE_UPDATE', update: { id: fileMeta.id, status: 'INDEXING', statusMessage: 'Processing with AI...' }});
            
            const fileData = { ...fileMeta, content };
            
            finalFileObject = await fileSearchService.indexSingleFile(client, fileData, settings.fileSearchServiceApiKey);
            
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
        
        onProgress({ type: 'FILE_UPDATE', update: { id: finalFileObject.id, status: finalFileObject.status, statusMessage: finalFileObject.statusMessage, type: finalFileObject.type }});
        allProcessedFiles.push(finalFileObject);
    }

    // 4. Update the client's file list in our database with the final state
    const updatedClient = await databaseService.updateClientFiles(clientId, allProcessedFiles);

    return { status: 'changed', client: updatedClient };
  },

};