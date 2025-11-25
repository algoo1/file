import { supabase } from './supabaseClient.ts';
import { Client, SystemSettings, SyncedFile, FileObject, Tag } from '../types.ts';

// This service interacts directly with the Supabase database.
export const databaseService = {
    // Settings Management
    getSettings: async (): Promise<SystemSettings> => {
        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('id', 1)
            .single();
        if (error) {
            console.error('Error fetching settings:', error);
            // On first run, the settings table might be empty.
            // Let's create a default entry.
            if (error.code === 'PGRST116') {
                 console.log("No settings found, creating default entry.");
                 const { data: newData, error: newError } = await supabase
                    .from('settings')
                    .insert({ id: 1, file_search_service_api_key: '' })
                    .select()
                    .single();
                if (newError) throw newError;
                return newData;
            }
            throw error;
        }
        return data;
    },
    saveSettings: async (newSettings: Partial<Omit<SystemSettings, 'id'>>): Promise<SystemSettings> => {
        const { data, error } = await supabase
            .from('settings')
            .update({ ...newSettings, updated_at: new Date().toISOString() })
            .eq('id', 1)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    // Client Management with Relations
    getClients: async (): Promise<Client[]> => {
        const { data, error } = await supabase
            .from('clients')
            .select(`
                *,
                synced_files (*),
                tags (*)
            `)
            .order('created_at', { ascending: true });

        if (error) throw error;
        return data as Client[];
    },
    getClientById: async (id: string): Promise<Client | undefined> => {
        const { data, error } = await supabase
            .from('clients')
            .select(`
                *,
                synced_files (*),
                tags (*)
            `)
            .eq('id', id)
            .single();
        
        if (error) {
            if(error.code === 'PGRST116') return undefined; // Not found is not an error
            throw error;
        }
        return data as Client;
    },
    addClient: async (name: string): Promise<Client> => {
        const apiKey = `sk-${crypto.randomUUID().replace(/-/g, '')}`;
        const { data, error } = await supabase
            .from('clients')
            .insert({ name, api_key: apiKey })
            .select()
            .single();

        if (error) throw error;
        // Return a fully formed Client object with empty relations
        return { ...data, synced_files: [], tags: [] };
    },
    updateClient: async (id: string, updates: Partial<Omit<Client, 'id'>>): Promise<Client> => {
        const { data, error } = await supabase
            .from('clients')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
            
        if (error) throw error;

        // Fetch the full client with relations to return a consistent object
        const fullClient = await databaseService.getClientById(id);
        if(!fullClient) throw new Error("Failed to fetch client after update.");
        return fullClient;
    },
    
    // Tag Management (within a client)
    addTagToClient: async(clientId: string, tagName: string): Promise<Tag> => {
        const { data, error } = await supabase
            .from('tags')
            .insert({ client_id: clientId, name: tagName })
            .select()
            .single();
        if(error) throw error;
        return data;
    },
    removeTagFromClient: async(tagId: string): Promise<void> => {
        const { error } = await supabase
            .from('tags')
            .delete()
            .eq('id', tagId);
        if (error) throw error;
    },
    
    // File Management (within a client)
    updateClientFiles: async (clientId: string, files: Partial<SyncedFile>[]): Promise<SyncedFile[]> => {
        if (files.length === 0) return [];

        // Use Upsert to update existing files or insert new ones.
        // We map the data to ensure client_id and updated_at are set.
        const updates = files.map(f => ({
            ...f,
            client_id: clientId,
            updated_at: new Date().toISOString()
        }));
        
        const { data, error } = await supabase
            .from('synced_files')
            .upsert(updates)
            .select();
        
        if (error) throw error;
        return data;
    },

    deleteClientFiles: async (ids: string[]): Promise<void> => {
        if (ids.length === 0) return;
        const { error } = await supabase
            .from('synced_files')
            .delete()
            .in('id', ids);
        if (error) throw error;
    }
};