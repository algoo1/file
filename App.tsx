
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Client, SystemSettings, SyncedFile, Tag } from './types.ts';
import { apiService } from './services/apiService.ts';
import { googleDriveService } from './services/googleDriveService.ts';
import { fileSearchService } from './services/fileSearchService.ts';
import { authService } from './services/supabaseClient.ts';
import ClientManager from './components/ClientManager.tsx';
import FileManager from './components/FileManager.tsx';
import SearchInterface from './components/SearchInterface.tsx';
import DataEditor from './components/DataEditor.tsx';
import ApiDetails from './components/ApiDetails.tsx';
import Settings from './components/Settings.tsx';
import GoogleAuthModal from './components/GoogleAuthModal.tsx';
import LoginPage from './components/LoginPage.tsx'; // Import Login Page
import { DriveIcon } from './components/icons/DriveIcon.tsx';
import { XCircleIcon } from './components/icons/XCircleIcon.tsx';

const App: React.FC = () => {
  // Auth State
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // App State
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isGoogleAuthModalOpen, setIsGoogleAuthModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'edit'>('search');
  
  // Sync State
  const [isSyncingClient, setIsSyncingClient] = useState<string | null>(null);
  const isAutoSyncingRef = useRef(false);

  // --- Auth & Session Management ---
  useEffect(() => {
    authService.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = authService.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  const handleUpdateClientState = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
  };

  // --- Initial Data Load (Only when authenticated) ---
  useEffect(() => {
    if (!session) return;

    const initializeApp = async () => {
      setIsLoading(true);
      try {
        setInitError(null);
        const { clients: initialClients, settings: initialSettings } = await apiService.getInitialData();
        setClients(initialClients);
        setSettings(initialSettings);
        if (initialClients.length > 0 && !selectedClientId) {
          setSelectedClientId(initialClients[0].id);
        }
        
        // Init Google Drive only if configured.
        // This will now silently refresh the token if possible.
        if (initialSettings.is_google_drive_connected && initialSettings.google_api_key && initialSettings.google_client_id) {
           await googleDriveService.init(initialSettings.google_api_key, initialSettings.google_client_id)
            .catch(e => console.warn("Background Drive init:", e));
        }

      } catch (error) {
        console.error("Failed to initialize app data:", error);
        setInitError(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      } finally {
        setIsLoading(false);
      }
    };
    initializeApp();
  }, [session]); // Runs when session becomes available

  // --- Auto Sync Logic ---
  useEffect(() => {
    if (!session || !selectedClient?.google_drive_folder_url) return;

    const syncClientData = async () => {
      if (!selectedClient?.id) return;
      if (isAutoSyncingRef.current || isSyncingClient === selectedClient.id) return;

      isAutoSyncingRef.current = true;

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
        // We pass 'false' for forceFullResync to rely on smart timestamp checks
        const result = await apiService.syncDataSource(selectedClient.id, onProgress, undefined, false);
        handleUpdateClientState(result.client);
      } catch (error) {
        // Silent error for auto-sync to avoid pestering user
        console.error(`[Auto-Sync] Error:`, error);
      } finally {
        isAutoSyncingRef.current = false;
      }
    };

    const intervalId = setInterval(syncClientData, 10000);
    return () => clearInterval(intervalId);
  }, [session, selectedClient?.id, selectedClient?.google_drive_folder_url]);


  // --- Event Handlers ---

  const handleSignOut = async () => {
    await authService.signOut();
    setSession(null);
  };

  const handleSaveSettings = useCallback(async (newSettings: Partial<SystemSettings>) => {
    try {
      const updatedSettings = await apiService.saveSettings(newSettings);
      setSettings(updatedSettings);
      return updatedSettings;
    } catch (error) {
      alert("Failed to save settings.");
      throw error;
    }
  }, []);

  const handleConnectGoogleDrive = useCallback(async (creds: { apiKey: string; clientId: string; }) => {
    try {
      await handleSaveSettings({ google_api_key: creds.apiKey, google_client_id: creds.clientId });
      await apiService.connectGoogleDrive(creds);
      const finalSettings = await apiService.saveSettings({ is_google_drive_connected: true });
      setSettings(finalSettings);
      setIsGoogleAuthModalOpen(false);
    } catch (error) {
      await apiService.saveSettings({ is_google_drive_connected: false });
      setSettings(prev => prev ? ({...prev, is_google_drive_connected: false}) : null);
      alert(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
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

  const handleSelectClient = useCallback((id: string) => setSelectedClientId(id), []);

  const handleSetFolderUrl = useCallback(async (clientId: string, url: string) => {
    const updatedClient = await apiService.updateClient(clientId, { google_drive_folder_url: url });
    handleUpdateClientState(updatedClient);
  }, []);

  const handleSyncFile = useCallback(async (clientId: string, file: SyncedFile) => {
    try {
      const result = await apiService.syncSingleFile(clientId, file);
      handleUpdateClientState(result.client);
    } catch (error) {
      alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const handleSyncNow = useCallback(async (clientId: string, forceResync: boolean = false) => {
    const client = clients.find(c => c.id === clientId);
    if (!client?.google_drive_folder_url) {
        alert("Please configure a Google Drive folder.");
        return;
    }

    setIsSyncingClient(clientId);
    // Reuse the same onProgress logic as auto-sync (simplified for brevity here)
    const onProgress = (event: any) => {
        setClients(prevClients => 
          prevClients.map(c => {
              if (c.id === clientId) {
                  let updatedFiles: SyncedFile[];
                  if (event.type === 'INITIAL_LIST') {
                      updatedFiles = event.files.map((f: any) => {
                          const existing = c.synced_files.find(ef => ef.source_item_id === f.source_item_id);
                          return {
                            ...(existing || {}),
                            ...f,
                            id: f.id || existing?.id || crypto.randomUUID(), 
                            client_id: clientId,
                            status: f.status || 'IDLE',
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
        alert(`Manual sync failed: ${error}`);
    } finally {
        setIsSyncingClient(null);
    }
  }, [clients]);

  const handleSearch = useCallback(async (query: string, source: 'ALL' | 'GOOGLE_DRIVE', image?: any) => {
    if (!selectedClient || !settings?.file_search_service_api_key) return "Configuration Error.";
    return await fileSearchService.query(selectedClient, query, settings.file_search_service_api_key, source, image);
  }, [selectedClient, settings]);
  
  const handleAddTag = useCallback(async (clientId: string, tagName: string) => {
      const newTag = await apiService.addTagToClient(clientId, tagName);
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, tags: [...c.tags, newTag] } : c));
  }, []);
  const handleRemoveTag = useCallback(async (clientId: string, tagId: string) => {
      await apiService.removeTagFromClient(tagId);
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, tags: c.tags.filter(t => t.id !== tagId) } : c));
  }, []);


  // --- Renders ---

  if (authLoading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading Auth...</div>;
  if (!session) return <LoginPage />;
  if (isLoading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white animate-pulse">Loading Workspace...</div>;
  if (initError) return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white p-4 text-center">
          <XCircleIcon className="w-16 h-16 text-red-500 mb-4" />
          <h2 className="text-xl font-bold">System Error</h2>
          <p className="text-gray-400 mt-2">{initError}</p>
      </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans flex flex-col">
      <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
            <DriveIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-xl md:text-2xl font-bold text-white">Drive Data Sync & Search API</h1>
        </div>
        <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400 hidden md:block">{session.user.email}</span>
            <button onClick={handleSignOut} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-md transition-colors">Sign Out</button>
        </div>
      </header>
      
      <main className="flex flex-col md:flex-row gap-6 p-4 md:p-6 flex-grow">
        <aside className="w-full md:w-1/3 lg:w-1/4 flex flex-col gap-6">
          <Settings settings={settings} onSave={handleSaveSettings} onOpenGoogleAuthModal={() => setIsGoogleAuthModalOpen(true)} />
          <ClientManager clients={clients} selectedClientId={selectedClientId} onAddClient={handleAddClient} onSelectClient={handleSelectClient} />
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
                    <button onClick={() => setActiveTab('search')} className={`flex-1 py-2 px-4 rounded-md font-semibold transition-colors ${activeTab === 'search' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>Search & Query</button>
                    <button onClick={() => setActiveTab('edit')} className={`flex-1 py-2 px-4 rounded-md font-semibold transition-colors ${activeTab === 'edit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>Smart Data Editor</button>
                </div>

                {activeTab === 'search' ? (
                     <>
                        <SearchInterface client={selectedClient} onSearch={handleSearch} />
                        <ApiDetails client={selectedClient} />
                     </>
                ) : (
                    <DataEditor client={selectedClient} fileSearchApiKey={settings?.file_search_service_api_key || ''} onSyncNow={async (id) => await handleSyncNow(id, true)} />
                )}
              </>
            ) : (
                <div className="bg-gray-800 rounded-lg p-8 h-full flex flex-col items-center justify-center text-center border border-gray-700">
                    <DriveIcon className="w-16 h-16 text-gray-500 mb-4" />
                    <h2 className="text-2xl font-semibold text-white">Welcome!</h2>
                    <p className="text-gray-400 mt-2">Select a client to manage files.</p>
                </div>
            )}
        </section>
      </main>
      
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
