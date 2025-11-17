import { Client, SystemSettings, SyncedFile, FileObject, Tag } from '../types.ts';

// Mock UUID generator
const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
});

// In-memory store
let settings: SystemSettings = {
    fileSearchServiceApiKey: '',
    googleApiKey: '',
    googleClientId: '',
    googleClientSecret: '', // Kept for backend compatibility but not used in frontend flow
    isGoogleDriveConnected: false,
};

let clients: Client[] = [];

// This service mimics a database or a persistent storage layer.
export const databaseService = {
    // Settings Management
    getSettings: async (): Promise<SystemSettings> => {
        await new Promise(res => setTimeout(res, 50)); // simulate async
        return { ...settings };
    },
    saveSettings: async (newSettings: Partial<SystemSettings>): Promise<SystemSettings> => {
        await new Promise(res => setTimeout(res, 50));
        settings = { ...settings, ...newSettings };
        return { ...settings };
    },

    // Client Management
    getClients: async (): Promise<Client[]> => {
        await new Promise(res => setTimeout(res, 50));
        return [...clients];
    },
    getClientById: async (id: string): Promise<Client | undefined> => {
        await new Promise(res => setTimeout(res, 50));
        return clients.find(c => c.id === id);
    },
    addClient: async (name: string): Promise<Client> => {
        await new Promise(res => setTimeout(res, 50));
        const newClient: Client = {
            id: uuidv4(),
            name,
            apiKey: `sk-${uuidv4().replace(/-/g, '')}`,
            googleDriveFolderUrl: null,
            syncedFiles: [],
            tags: [],
            syncInterval: 'MANUAL',
        };
        clients = [...clients, newClient];
        return { ...newClient };
    },
    updateClient: async (id: string, updates: Partial<Omit<Client, 'id'>>): Promise<Client> => {
        await new Promise(res => setTimeout(res, 50));
        let clientToUpdate = clients.find(c => c.id === id);
        if (!clientToUpdate) {
            throw new Error("Client not found");
        }
        clientToUpdate = { ...clientToUpdate, ...updates };
        clients = clients.map(c => c.id === id ? clientToUpdate : c);
        return { ...clientToUpdate };
    },
    
    // Tag Management (within a client)
    addTagToClient: async(clientId: string, tagName: string): Promise<Client> => {
        const client = await databaseService.getClientById(clientId);
        if (!client) throw new Error("Client not found");
        const newTag: Tag = { id: uuidv4(), name: tagName };
        const updatedTags = [...client.tags, newTag];
        return await databaseService.updateClient(clientId, { tags: updatedTags });
    },

    removeTagFromClient: async(clientId: string, tagId: string): Promise<Client> => {
        const client = await databaseService.getClientById(clientId);
        if (!client) throw new Error("Client not found");
        const updatedTags = client.tags.filter(t => t.id !== tagId);
        return await databaseService.updateClient(clientId, { tags: updatedTags });
    },
    
    // File Management (within a client)
    updateClientFiles: async (clientId: string, files: FileObject[]): Promise<Client> => {
        const syncedFiles: SyncedFile[] = files.map(f => ({
            id: f.id,
            name: f.name,
            status: f.status,
        }));
        return await databaseService.updateClient(clientId, { syncedFiles });
    }
};