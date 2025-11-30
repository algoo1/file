
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Client, SystemSettings, SyncedFile, Tag } from './types.ts';
import { apiService } from './services/apiService.ts';
import { googleDriveService } from './services/googleDriveService.ts';
import { fileSearchService } from './services/fileSearchService.ts';
import ClientManager from './components/ClientManager.tsx';
import FileManager from './components/FileManager.tsx';
import SearchInterface from './components/SearchInterface.tsx';
import DataEditor from './components/DataEditor.tsx';
import ApiDetails from './components/ApiDetails.tsx';
import Settings from './components/Settings.tsx';
import GoogleAuthModal from './components/GoogleAuthModal.tsx';
import { DriveIcon } from './components/icons/DriveIcon.tsx';
import { XCircleIcon } from './components/icons/XCircleIcon.tsx';

const App: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [isGoogleAuthModalOpen, setIsGoogleAuthModalOpen] = useState(false);
  
  // New state for switching views
  const [activeTab, setActiveTab] = useState<'search' | 'edit'>('search');
  
  // Track syncing state strictly to prevent overlapping syncs during the 10s polling
  const [isSyncingClient, setIsSyncingClient] = useState<string | null>(null);

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  const handleUpdateClientState = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
  };

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
  
  // Effect to initialize Google Drive client on startup
  useEffect(() => {
    if (settings?.is_google_drive_connected && settings.google_api_key && settings.google_client_id) {
      console.log("Initializing Google Drive client on app startup...");
      googleDriveService.init(settings.google_api_key, settings.google_client_id).catch(error => {
        console.warn("Failed to silently initialize Google Drive client on startup:", error);
        // This is not a fatal error, user can reconnect manually.
      });
    }
  }, [settings]);

  // FIXED SYNC MECHANISM: 10 Seconds Loop
  useEffect(() => {
    const hasDataSource = !!selectedClient?.google_drive_folder_url;

    if (!selectedClient || !hasDataSource) {
      return;
    }

    const syncClientData = async () => {
      if (!selectedClient?.id) return;
      
      // Prevent overlapping syncs if the previous one is still running
      if (isSyncingClient === selectedClient.id) {
          console.log(`Sync for ${selectedClient.name} skipped: Previous sync still in progress.`);
          return;
      }

      console.log(`[Auto-Sync] Checking for modifications for client: ${selectedClient.name}...`);

      const onProgress = (event: { type: 'INITIAL_LIST', files: Partial<SyncedFile>[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { source_item_id: string } }) => {
           setClients(prevClients => 
              prevClients.map(c => {
                  if (c.id === selectedClient.id) {
                      let updatedFiles: SyncedFile[];
                      if (event.type === 'INITIAL_LIST') {
                          updatedFiles = event.files.map(f => {
                              const existing = c.synced_files.find(ef => ef.source_item_id === f.source_item_id);
                              return {
                                ...(existing || {}),
                                ...f,
                                id: f.id || existing?.id || crypto.randomUUID(),
                                client_id: selectedClient.id,
                                status: f.status || 'IDLE',
                                created_at: existing?.created_at || new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                              } as SyncedFile;
                          });
                      } else {
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
        const result = await apiService.syncDataSource(selectedClient.id, onProgress);
        handleUpdateClientState(result.client);
        console.log(`[Auto-Sync] Completed for ${selectedClient.name}.`);
      } catch (error) {
        console.error(`[Auto-Sync] Failed for ${selectedClient.name}:`, error);
      }
    };

    // Initial sync on mount/selection
    syncClientData();

    // Set interval for 10 seconds
    const intervalId = setInterval(syncClientData, 10000);
    return () => clearInterval(intervalId);
  }, [selectedClient?.id, selectedClient?.google_drive_folder_url]); 


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


  const handleSyncFile = useCallback(async (clientId: string, file: SyncedFile) => {
    try {
      const result = await apiService.syncSingleFile(clientId, file);
      handleUpdateClientState(result.client);
    } catch (error) {
      console.error("Single file sync failed:", error);
      alert(`Failed to sync file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const handleSyncNow = useCallback(async (clientId: string, forceResync: boolean = false) => {
    const client = clients.find(c => c.id === clientId);
     const hasDataSource = !!client?.google_drive_folder_url;

    if (!hasDataSource) {
        alert("Please configure a Google Drive folder before syncing.");
        return;
    }

    setIsSyncingClient(clientId);
    
    const onProgress = (event: { type: 'INITIAL_LIST', files: Partial<SyncedFile>[] } | { type: 'FILE_UPDATE', update: Partial<SyncedFile> & { source_item_id: string } }) => {
      setClients(prevClients => 
          prevClients.map(c => {
              if (c.id === clientId) {
                  let updatedFiles: SyncedFile[];
                  if (event.type === 'INITIAL_LIST') {
                      updatedFiles = event.files.map(f => {
                          const existing = c.synced_files.find(ef => ef.source_item_id === f.source_item_id);
                          return {
                            ...(existing || {}),
                            ...f,
                            id: f.id || existing?.id || crypto.randomUUID(),
                            client_id: clientId,
                            status: f.status || 'IDLE',
                            created_at: existing?.created_at || new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          } as SyncedFile;
                      });
                  } else { 
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
        const result = await apiService.syncDataSource(clientId, onProgress, undefined, forceResync);
        handleUpdateClientState(result.client);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Manual sync failed:", errorMessage);
        alert(`Failed to sync data source: ${errorMessage}`);
        
        setClients(prevClients => 
            prevClients.map(c => {
                if (c.id === clientId) {
                    const updatedFiles = c.synced_files.map(f => {
                        if (f.status === 'SYNCING' || f.status === 'INDEXING') {
                             return { ...f, status: 'FAILED' as const, status_message: `Sync failed: ${errorMessage}` };
                        }
                        return f;
                    });
                    return { ...c, synced_files: updatedFiles };
                }
                return c;
            })
        );
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

  const handleSearch = useCallback(async (
    query: string, 
    source: 'ALL' | 'GOOGLE_DRIVE',
    image?: { data: string; mimeType: string }
  ) => {
    if (!selectedClient) return "No client selected.";
    if (!settings?.file_search_service_api_key) return "Error: File Search Service API Key is not configured in Settings.";
    return await fileSearchService.query(selectedClient, query, settings.file_search_service_api_key, source, image);
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
              onSetFolderUrl={handleSetFolderUrl}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onSyncNow={handleSyncNow}
              onSyncFile={handleSyncFile}
              isSyncing={isSyncingClient === selectedClient.id}
            />
          )}
        </aside>

        <section className="w-full md:w-2/3 lg:w-3/4 flex flex-col gap-6">
            {selectedClient ? (
              <>
                <div className="flex items-center gap-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
                    <button 
                        onClick={() => setActiveTab('search')}
                        className={`flex-1 py-2 px-4 rounded-md font-semibold transition-colors ${activeTab === 'search' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                        Search & Query
                    </button>
                    <button 
                        onClick={() => setActiveTab('edit')}
                        className={`flex-1 py-2 px-4 rounded-md font-semibold transition-colors ${activeTab === 'edit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                        Smart Data Editor
                    </button>
                </div>

                {activeTab === 'search' ? (
                     <>
                        <SearchInterface client={selectedClient} onSearch={handleSearch} />
                        <ApiDetails client={selectedClient} />
                     </>
                ) : (
                    <DataEditor 
                        client={selectedClient} 
                        fileSearchApiKey={settings?.file_search_service_api_key || ''} 
                        onSyncNow={async (id) => await handleSyncNow(id, true)} 
                    />
                )}
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
        <p>v1.4.2 (Smart Editor)</p>
      </footer>

      {isGoogleAuthModalOpen && settings && (
        <GoogleAuthModal 
            onClose={() => setIsGoogleAuthModalOpen(false)}
            initialSettings={settings}
            onConnect={handleConnectGoogleDrive}
            isConnected={!!settings.is_google_drive_connected}
        />
      )}
    </div>
  );
};

export default App;