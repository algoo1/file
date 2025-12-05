
import { supabase } from './supabaseClient.ts';
import { Client, SystemSettings, SyncedFile, FileObject, Tag } from '../types.ts';

// Helper to get current user ID safely
const getCurrentUserId = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) throw new Error("User not authenticated");
    return session.user.id;
};

// This service interacts directly with the Supabase database.
export const databaseService = {
    // Auth & Access Control
    validateInviteCode: async (code: string): Promise<boolean> => {
        // We use a Remote Procedure Call (RPC) to check the code securely on the server.
        // This function should check the 'access_codes' table and mark the code as used.
        const { data, error } = await supabase
            .rpc('check_invite_code', { lookup_code: code });
        
        if (error) {
            console.error("Database Error (validateInviteCode):", error);
            // Provide a clear hint if the function is missing
            if (error.message.includes('function') && error.message.includes('does not exist')) {
                throw new Error("System Error: The 'check_invite_code' function is missing in the database. Please run the SQL setup script.");
            }
            throw error;
        }
        return !!data;
    },

    // Settings Management
    getSettings: async (): Promise<SystemSettings> => {
        const userId = await getCurrentUserId();

        // Fetch settings specifically for THIS user
        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) {
            // If no settings exist for this user, create them.
            if (error.code === 'PGRST116') {
                 console.log("No settings found for user, creating default entry.");
                 const { data: newData, error: newError } = await supabase
                    .from('settings')
                    .insert({ 
                        user_id: userId, 
                        // Random ID is generally fine if ID is not serial, but usually Supabase handles IDs.
                        // We rely on Supabase to generate the ID or use the user_id as a reference.
                        file_search_service_api_key: '',
                        is_google_drive_connected: false
                    })
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
        const userId = await getCurrentUserId();
        
        // Update settings where user_id matches
        const { data, error } = await supabase
            .from('settings')
            .update({ ...newSettings, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    // Client Management with Relations
    getClients: async (): Promise<Client[]> => {
        // Supabase RLS policies (if set up) will automatically filter by user,
        // but adding .eq('user_id', userId) is good practice for explicit safety.
        const userId = await getCurrentUserId();

        // 1. Fetch Clients
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('*')
            .eq('user_id', userId) 
            .order('created_at', { ascending: true });

        if (clientsError) throw clientsError;
        if (!clients || clients.length === 0) return [];

        const clientIds = clients.map(c => c.id);
        
        // 2. Fetch related data SAFELY
        let files: SyncedFile[] = [];
        try {
            const { data, error } = await supabase
                .from('synced_files')
                .select('*')
                .in('client_id', clientIds);
            
            if (error) throw error;
            files = data as SyncedFile[];
        } catch (e) {
            console.warn("Soft Error: Could not fetch synced_files.", e);
        }

        let tags: Tag[] = [];
        try {
            const { data, error } = await supabase
                .from('tags')
                .select('*')
                .in('client_id', clientIds);
            
            if (error) throw error;
            tags = data as Tag[];
        } catch (e) {
            console.warn("Soft Error: Could not fetch tags.", e);
        }

        // 3. Merge data locally
        return clients.map(client => ({
            ...client,
            synced_files: files.filter(f => f.client_id === client.id),
            tags: tags.filter(t => t.client_id === client.id)
        }));
    },
    
    getClientById: async (id: string): Promise<Client | undefined> => {
        const { data: client, error: clientError } = await supabase
            .from('clients')
            .select('*')
            .eq('id', id)
            .single();
        
        if (clientError) {
            if(clientError.code === 'PGRST116') return undefined; // Not found
            throw clientError;
        }

        let files: SyncedFile[] = [];
        try {
             const { data, error } = await supabase
                .from('synced_files')
                .select('*')
                .eq('client_id', id);
             if (error) throw error;
             files = data as SyncedFile[];
        } catch (e) { console.warn(e); }

        let tags: Tag[] = [];
        try {
            const { data, error } = await supabase
                .from('tags')
                .select('*')
                .eq('client_id', id);
            if (error) throw error;
            tags = data as Tag[];
        } catch (e) { console.warn(e); }

        return {
            ...client,
            synced_files: files,
            tags: tags
        } as Client;
    },

    addClient: async (name: string): Promise<Client> => {
        const userId = await getCurrentUserId();
        const apiKey = `sk-${crypto.randomUUID().replace(/-/g, '')}`;
        
        const { data, error } = await supabase
            .from('clients')
            .insert({ 
                name, 
                api_key: apiKey,
                user_id: userId // CRITICAL: Link to user
            })
            .select()
            .single();

        if (error) throw error;
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
        const fullClient = await databaseService.getClientById(id);
        if(!fullClient) throw new Error("Failed to fetch client after update.");
        return fullClient;
    },
    
    // Tag Management
    addTagToClient: async(clientId: string, tagName: string): Promise<Tag> => {
        // Tag implicitly belongs to user via client_id, but we can add user_id to tags table if strict RLS needed
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
    
    // File Management
    updateClientFiles: async (clientId: string, files: Partial<SyncedFile>[]): Promise<SyncedFile[]> => {
        if (files.length === 0) return [];
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
    },
    
    deleteClientFilesBySourceId: async (clientId: string, sourceItemIds: string[]): Promise<void> => {
        if (sourceItemIds.length === 0) return;
        const { error } = await supabase
            .from('synced_files')
            .delete()
            .eq('client_id', clientId)
            .in('source_item_id', sourceItemIds);
        if (error) throw error;
    },

    searchFiles: async (clientId: string, query: string): Promise<SyncedFile[]> => {
        const { data, error } = await supabase
            .from('synced_files')
            .select('*')
            .eq('client_id', clientId)
            .or(`name.ilike.%${query}%,summary.ilike.%${query}%,content.ilike.%${query}%`)
            .limit(10); 

        if (error) {
            console.error('Database search error:', error);
            return [];
        }
        return data as SyncedFile[];
    }
};
