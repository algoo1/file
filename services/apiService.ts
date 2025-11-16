import { databaseService } from './databaseService.ts';
import { googleDriveService } from './googleDriveService.ts';
import { fileSearchService } from './fileSearchService.ts';
import { SystemSettings, Client, FileObject } from '../types.ts';

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

  syncDataSource: async (clientId: string) => {
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

    // 1. Fetch files from Google Drive
    const filesFromDrive = await googleDriveService.getFilesFromFolder(client.googleDriveFolderUrl);
    
    // Check if there's any change by comparing file IDs
    const currentFileIds = new Set(client.syncedFiles.map(f => f.id));
    const newFileIds = new Set(filesFromDrive.map(f => f.id));
    
    if (currentFileIds.size === newFileIds.size && [...currentFileIds].every(id => newFileIds.has(id))) {
      console.log("No file changes detected, skipping sync.");
      return { status: 'unchanged', client };
    }

    // 2. Index files with the external search service
    const processedFiles: FileObject[] = await fileSearchService.syncClientFiles(
        client,
        filesFromDrive,
        settings.fileSearchServiceApiKey
    );

    // 3. Update the client's file list in our database
    const updatedClient = await databaseService.updateClientFiles(clientId, processedFiles);

    return { status: 'changed', client: updatedClient };
  },

  query: async (clientApiKey: string, query: string): Promise<string> => {
      const clients = await databaseService.getClients();
      const settings = await databaseService.getSettings();
      
      const client = clients.find(c => c.apiKey === clientApiKey);
      if (!client) {
          return "Error: Invalid Client API Key provided.";
      }
       if (!settings.fileSearchServiceApiKey) {
          return "Error: File Search Service is not configured by the administrator.";
       }

      return await fileSearchService.query(client, query, settings.fileSearchServiceApiKey);
  }
};
