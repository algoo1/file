

import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject, SyncedFile } from '../types.ts';

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
        await databaseService.saveSettings({ isGoogleDriveConnected: true });
        return { connected: true };
    } catch (error) {
        // Reset connection status on failure
        await databaseService.saveSettings({ isGoogleDriveConnected: false });
        console.error("Connection failed in apiService:", error);
        // Rethrow the error so the UI can display it
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

    if (!client || !client.googleDriveFolderUrl) {
      throw new Error("Client or folder URL is not configured.");
    }
    if (!settings.isGoogleDriveConnected) {
      throw new Error("Google Drive is not connected.");
    }
     if (!settings.fileSearchServiceApiKey) {
      throw new Error("File Search Service API Key is not set.");
    }

    // 1. Fetch list of file metadata from Google Drive
    const filesMetaFromDrive = await googleDriveService.getListOfFiles(client.googleDriveFolderUrl);
    
    // Check if there's any change by comparing file IDs and names to avoid unnecessary syncs
    const currentFilesSignature = client.syncedFiles.map(f => f.id + f.name).sort().join();
    const newFilesSignature = filesMetaFromDrive.map(f => f.id + f.name).sort().join();

    if (currentFilesSignature === newFilesSignature) {
        console.log("No file changes detected, skipping sync.");
        return { status: 'unchanged', client };
    }
    
    const getFileType = (mimeType: string): 'pdf' | 'sheet' | 'image' => {
      if (mimeType.includes('spreadsheet')) return 'sheet';
      if (mimeType.startsWith('image/')) return 'image';
      return 'pdf'; // Default for PDF, GDoc, text
    };

    // 2. Prepare initial UI state and clear the old search index
    const initialSyncedFiles: SyncedFile[] = filesMetaFromDrive.map(f => ({
        id: f.id,
        name: f.name,
        status: 'IDLE',
        statusMessage: 'In queue...',
        type: getFileType(f.mimeType),
    }));

    onProgress({ type: 'INITIAL_LIST', files: initialSyncedFiles });
    await fileSearchService.clearIndexForClient(clientId);


    // 3. Process each file sequentially
    const allProcessedFiles: FileObject[] = [];
    for (const fileMeta of filesMetaFromDrive) {
        let finalFileObject: FileObject;
        const fileType = getFileType(fileMeta.mimeType);
        
        try {
            onProgress({ type: 'FILE_UPDATE', update: { id: fileMeta.id, status: 'SYNCING', statusMessage: 'Fetching content...' }});
            const content = await googleDriveService.getFileContent(fileMeta.id, fileMeta.mimeType);

            onProgress({ type: 'FILE_UPDATE', update: { id: fileMeta.id, status: 'INDEXING', statusMessage: 'Processing with AI...' }});
            
            const fileData = {
                id: fileMeta.id,
                name: fileMeta.name,
                content: content,
                type: fileType,
                mimeType: fileMeta.mimeType,
            };
            
            finalFileObject = await fileSearchService.indexSingleFile(client, fileData, settings.fileSearchServiceApiKey);
            
        } catch (error) {
             console.error(`Critical error processing file ${fileMeta.name}:`, error);
             finalFileObject = {
                 id: fileMeta.id,
                 name: fileMeta.name,
                 type: fileType,
                 mimeType: fileMeta.mimeType,
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