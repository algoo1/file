
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Client, SystemSettings, SyncedFile } from './types.ts';
import { apiService } from './services/apiService.ts';
import { airtableService } from './services/airtableService.ts';
import { fileSearchService } from './services/fileSearchService.ts';
import ClientManager from './components/ClientManager.tsx';
import FileManager from './components/FileManager.tsx';
import SearchInterface from './components/SearchInterface.tsx';
import ApiDetails from './components/ApiDetails.tsx';
import Settings from './components/Settings.tsx';
import GoogleAuthModal from './components/GoogleAuthModal.tsx';
import AirtableAuthModal from './components/AirtableAuthModal.tsx';
import { DriveIcon } from './components/icons/DriveIcon.tsx';
import { XCircleIcon } from './components/icons/XCircleIcon.tsx';

const App: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [isGoogleAuthModalOpen, setIsGoogleAuthModalOpen] = useState(false);
  const [isAirtableAuthModalOpen, setIsAirtableAuthModalOpen] = useState(false);
  const [isSyncingClient, setIsSyncingClient] = useState<string | null>(null);

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  const handleUpdateClientState = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
  };

  // Effect to handle Airtable OAuth callback
  useEffect(() => {
    const handleAirtableRedirect = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state'); // Contains clientId
      
      if (code && state) {
        console.log("Detected Airtable OAuth callback.");
        const clientId = state;
        const currentClient = clients.find(c => c.id === clientId);

        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        if (currentClient && settings?.airtable_client_id) {
          try {
            const tokenData = await airtableService.handleOAuthCallback(code, settings.airtable_client_id);
            const updatedClient = await apiService.updateClient(clientId, tokenData);
            handleUpdateClientState(updatedClient);
            setSelectedClientId(clientId); // Ensure the client is selected
            alert("Airtable connected successfully!");
          } catch (error) {
            console.error("Airtable OAuth failed:", error);
            alert(`Failed to connect Airtable: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    };

    if (clients.length > 0 && settings) {
      handleAirtableRedirect();
    }
  }, [clients, settings]); // Run when clients and settings are loaded

  useEffect(() => {
    const initializeApp = async () => {
      try {
        setInitError(null);
        const { clients: initialClients, settings: initialSettings } = await apiService.getInitialData();
        setClients(initialClients);
        setSettings(initialSettings);
        if (initialClients.length > 0 && !selectedClientId) {
          setSelectedClientId(initialClients[0].id);
        }
      } catch (error) {
        console.error("Failed to initialize app data:", error);
        const errorMessage = `Could not connect to the database. This is likely due to an incomplete database setup or incorrect RLS policies. Please run the complete setup script in your Supabase SQL Editor. Error: ${error instanceof Error ? error.message : 'Unknown'}`;
        setInitError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };
    initializeApp();
  }, []);

  // Background sync effect
  useEffect(() => {
    const hasDataSource = selectedClient?.google_drive_folder_url || 
                          (selectedClient?.airtable_api_key && selectedClient?.airtable_base_id && selectedClient?.airtable_table_id) ||
                          (selectedClient?.airtable_access_token && selectedClient?.airtable_base_id && selectedClient?.airtable_table_id);

    if (!selectedClient || selectedClient.sync_interval === 'MANUAL' || !hasDataSource) {
      return;
    }

    const syncClientData = async () => {
      if (!selectedClient?.id) return;
      console.log(`Auto-syncing for client: ${selectedClient.name} with interval ${selectedClient.sync_interval}ms`);
      try {
        const result = await apiService.syncDataSource(selectedClient.id, () => {});
        handleUpdateClientState(result.client);
        console.log(`Auto-sync successful for ${selectedClient.name}.`);
      } catch (error) {
        console.error(`Auto-sync failed for ${selectedClient.name}:`, error);
      }
    };

    const intervalId = setInterval(syncClientData, selectedClient.sync_interval as number);
    return () => clearInterval(intervalId);
  }, [selectedClient]);


  const handleSaveSettings = useCallback(async (newSettings: Partial<SystemSettings>) => {
    try {
      const updatedSettings = await apiService.saveSettings(newSettings);
      setSettings(updatedSettings);
      return updatedSettings;
    } catch (error) {
      console.error("Failed to save settings:", error);
      alert("Failed to save settings.");
      throw error;
    }
  }, []);
  
  const handleConnectGoogleDrive = useCallback(async (creds: { apiKey: string; clientId: string; }) => {
    try {
      await handleSaveSettings({
        google_api_key: creds.apiKey,
        google_client_id: creds.clientId,
      });
      await apiService.connectGoogleDrive(creds);
      const finalSettings = await apiService.saveSettings({ is_google_drive_connected: true });
      setSettings(finalSettings);
      setIsGoogleAuthModalOpen(false);
    } catch (error) {
      const finalSettings = await apiService.saveSettings({ is_google_drive_connected: false });
      setSettings(finalSettings);
      console.error("Google Drive connection failed:", error);
      alert(`Failed to connect to Google Drive: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }, [handleSaveSettings]);

  const handleSaveAirtableSettings = useCallback(async (clientId: string) => {
    try {
      await handleSaveSettings({ airtable_client_id: clientId });
      const finalSettings = await apiService.saveSettings({ is_airtable_connected: true });
      setSettings(finalSettings);
      setIsAirtableAuthModalOpen(false);
      alert("Airtable settings saved. You can now connect clients using OAuth.");
    } catch(error) {
      console.error("Failed to save Airtable settings:", error);
      alert("Failed to save Airtable settings.");
    }
  }, [handleSaveSettings]);

  const handleInitiateAirtableOAuth = useCallback((clientId: string) => {
    if (settings?.airtable_client_id) {
      airtableService.initiateOAuth(settings.airtable_client_id, clientId);
    } else {
      alert("Airtable integration has not been set up in Settings.");
    }
  }, [settings]);

  const handleAddClient = useCallback(async (name: string) => {
    if (name.trim()) {
      const newClient = await apiService.addClient(name);
      setClients(prev => [...prev, newClient]);
      setSelectedClientId(newClient.id);
    }
  }, []);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
  }, []);
  
  const handleSetFolderUrl = useCallback(async (clientId: string, url: string) => {
    const updatedClient = await apiService.updateClient(clientId, { google_drive_folder_url: url });
    handleUpdateClientState(updatedClient);
  }, []);

   const handleSetAirtableDetails = useCallback(async (clientId: string, details: Partial<Client>) => {
    const updatedClient = await apiService.updateClient(clientId, details);
    handleUpdateClientState(updatedClient);
  }, []);

  const handleSetSyncInterval = useCallback(async (clientId: string, interval: number | 'MANUAL') => {
    const updatedClient = await apiService.updateClient(clientId, { sync_interval: interval });
    handleUpdateClientState(updatedClient);
  }, []);

  const handleSyncNow = useCallback(async (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
     const hasDataSource = client?.google_drive_folder_url || 
                          (client?.airtable_api_key && client?.airtable_base_id && client?.airtable_table_id) ||
                          (client?.airtable_access_token && client?.airtable_base_id && client?.airtable_table_id);

    if (!hasDataSource) {
        alert("Please configure at least one data source before syncing.");
        return;
    }

    setIsSyncingClient(clientId);
    
    // Type definition for progress callback events.
    type ProgressEvent = { type: 'INITIAL_LIST', files: Partial<SyncedFile>[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { source_item_id: string } };

    const onProgress = (event: ProgressEvent) => {
      setClients(prevClients => 
          prevClients.map(c => {
              if (c.id === clientId) {
                  let updatedFiles: SyncedFile[];
                  if (event.type === 'INITIAL_LIST') {
                      // Map partial file data to full SyncedFile structure, providing defaults.
                      updatedFiles = event.files.map(f => ({
                          ...f,
                          id: f.id || crypto.randomUUID(),
                          client_id: clientId,
                          status: f.status || 'IDLE',
                          created_at: new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                      } as SyncedFile));
                  } else { // 'FILE_UPDATE'
                      // Find and update the specific file in the client's list.
                      updatedFiles = c.synced_files.map(f =>
                          f.source_item_id === event.update.source_item_id ? { ...f, ...event.update } : f
                      );
                  }
                  return { ...c, synced_files: updatedFiles };
              }
              return c;
          })
      );
    };


    try {
        const result = await apiService.syncDataSource(clientId, onProgress);
        handleUpdateClientState(result.client);
    } catch (error) {
        console.error("Manual sync failed:", error);
        alert(`Failed to sync data source: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        setIsSyncingClient(null);
    }
  }, [clients]);
  
  const handleAddTag = useCallback(async (clientId: string, tagName: string) => {
    const newTag = await apiService.addTagToClient(clientId, tagName);
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, tags: [...c.tags, newTag] } : c));
  }, []);
  
  const handleRemoveTag = useCallback(async (clientId: string, tagId: string) => {
    await apiService.removeTagFromClient(tagId);
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, tags: c.tags.filter(t => t.id !== tagId) } : c));
  }, []);

  const handleSearch = useCallback(async (query: string, image?: { data: string; mimeType: string }) => {
    if (!selectedClient) return "No client selected.";
    if (!settings?.file_search_service_api_key) return "Error: File Search Service API Key is not configured in Settings.";
    return await fileSearchService.query(selectedClient, query, settings.file_search_service_api_key, image);
  }, [selectedClient, settings]);

  if (isLoading) {
    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-center">
            <DriveIcon className="w-16 h-16 text-blue-500 animate-pulse mb-4" />
            <h2 className="text-2xl font-semibold text-white">Connecting to database...</h2>
            <p className="text-gray-400 mt-2">Loading your data sync workspace.</p>
        </div>
    );
  }
  
  if (initError) {
    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-center p-4">
            <XCircleIcon className="w-16 h-16 text-red-500 mb-4" />
            <h2 className="text-2xl font-semibold text-white">Application Initialization Failed</h2>
            <p className="text-gray-400 mt-2 max-w-xl">{initError}</p>
            <p className="text-gray-500 mt-4 text-xs">Check the browser console for more technical details.</p>
        </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans flex flex-col">
      <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
            <DriveIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-xl md:text-2xl font-bold text-white">Drive Data Sync & Search API</h1>
        </div>
      </header>
      
      <main className="flex flex-col md:flex-row gap-6 p-4 md:p-6 flex-grow">
        <aside className="w-full md:w-1/3 lg:w-1/4 flex flex-col gap-6">
          <Settings 
            settings={settings}
            onSave={handleSaveSettings}
            onOpenGoogleAuthModal={() => setIsGoogleAuthModalOpen(true)}
            onOpenAirtableAuthModal={() => setIsAirtableAuthModalOpen(true)}
          />
          <ClientManager 
            clients={clients} 
            selectedClientId={selectedClientId}
            onAddClient={handleAddClient} 
            onSelectClient={handleSelectClient} 
          />
          {selectedClient && settings && (
            <FileManager 
              client={selectedClient}
              isGoogleDriveConnected={!!settings.is_google_drive_connected}
              isAirtableSetUp={!!settings.is_airtable_connected}
              onSetFolderUrl={handleSetFolderUrl}
              onSetAirtableDetails={handleSetAirtableDetails}
              onInitiateAirtableOAuth={handleInitiateAirtableOAuth}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onSetSyncInterval={handleSetSyncInterval}
              onSyncNow={handleSyncNow}
              isSyncing={isSyncingClient === selectedClient.id}
            />
          )}
        </aside>

        <section className="w-full md:w-2/3 lg:w-3/4 flex flex-col gap-6">
            {selectedClient ? (
              <>
                <SearchInterface client={selectedClient} onSearch={handleSearch} />
                <ApiDetails client={selectedClient} />
              </>
            ) : (
                <div className="bg-gray-800 rounded-lg p-8 h-full flex flex-col items-center justify-center text-center border border-gray-700">
                    <DriveIcon className="w-16 h-16 text-gray-500 mb-4" />
                    <h2 className="text-2xl font-semibold text-white">Welcome!</h2>
                    <p className="text-gray-400 mt-2">Configure your settings and add a new client to begin.</p>
                </div>
            )}
        </section>
      </main>

      <footer className="text-center py-2 text-xs text-gray-600 border-t border-gray-800">
        <p>v1.1.0 (Supabase Edition)</p>
      </footer>

      {isGoogleAuthModalOpen && settings && (
        <GoogleAuthModal 
            onClose={() => setIsGoogleAuthModalOpen(false)}
            initialSettings={settings}
            onConnect={handleConnectGoogleDrive}
            isConnected={!!settings.is_google_drive_connected}
        />
      )}
      {isAirtableAuthModalOpen && settings && (
        <AirtableAuthModal 
            onClose={() => setIsAirtableAuthModalOpen(false)}
            initialSettings={settings}
            onSave={handleSaveAirtableSettings}
        />
      )}
    </div>
  );
};

export default App;
