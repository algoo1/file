import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Client, SystemSettings } from './types.ts';
import { apiService } from './services/apiService.ts';
import { fileSearchService } from './services/fileSearchService.ts';
import ClientManager from './components/ClientManager.tsx';
import FileManager from './components/FileManager.tsx';
import SearchInterface from './components/SearchInterface.tsx';
import ApiDetails from './components/ApiDetails.tsx';
import Settings from './components/Settings.tsx';
import GoogleAuthModal from './components/GoogleAuthModal.tsx';
import { DriveIcon } from './components/icons/DriveIcon.tsx';

const App: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const { clients: initialClients, settings: initialSettings } = await apiService.getInitialData();
        setClients(initialClients);
        setSettings(initialSettings);
        if (initialClients.length > 0 && !selectedClientId) {
          setSelectedClientId(initialClients[0].id);
        }
      } catch (error) {
        console.error("Failed to initialize app data:", error);
        alert("Could not connect to the server. Please refresh the page.");
      } finally {
        setIsLoading(false);
      }
    };
    initializeApp();
  }, []);

  // Background sync effect
  useEffect(() => {
    if (!selectedClient || selectedClient.syncInterval === 'MANUAL' || !selectedClient.googleDriveFolderUrl) {
      return; // Do nothing if no client, manual sync, or no folder URL
    }

    const syncClientData = async () => {
      if (!selectedClient?.id) return;
      console.log(`Auto-syncing for client: ${selectedClient.name} with interval ${selectedClient.syncInterval}ms`);
      try {
        const result = await apiService.syncDataSource(selectedClient.id);
        if (result.status === 'changed') {
          // Use functional update to avoid capturing stale state in the interval closure
          setClients(prevClients => prevClients.map(c => c.id === result.client.id ? result.client : c));
          console.log(`Auto-sync successful for ${selectedClient.name}: files updated.`);
        } else {
          console.log(`Auto-sync successful for ${selectedClient.name}: no changes detected.`);
        }
      } catch (error) {
        console.error(`Auto-sync failed for ${selectedClient.name}:`, error);
        // In a real app, you might want to add logic to stop syncing after several failures.
      }
    };

    const intervalId = setInterval(syncClientData, selectedClient.syncInterval as number);

    // Cleanup function to clear the interval when the component unmounts or dependencies change
    return () => clearInterval(intervalId);
  }, [selectedClient?.id, selectedClient?.syncInterval, selectedClient?.googleDriveFolderUrl]);


  const handleSaveSettings = useCallback(async (newSettings: Partial<SystemSettings>) => {
    try {
      const updatedSettings = await apiService.saveSettings(newSettings);
      setSettings(updatedSettings);
      return updatedSettings;
    } catch (error) {
      console.error("Failed to save settings:", error);
      alert("Failed to save settings.");
      throw error; // re-throw for component to handle
    }
  }, []);
  
  const handleConnectGoogleDrive = useCallback(async (creds: { apiKey: string; clientId: string; }) => {
    try {
      await handleSaveSettings({
        googleApiKey: creds.apiKey,
        googleClientId: creds.clientId,
      });
      await apiService.connectGoogleDrive(creds);
      const finalSettings = await apiService.saveSettings({ isGoogleDriveConnected: true }); // Ensure state is correct
      setSettings(finalSettings);
      setIsAuthModalOpen(false);
    } catch (error) {
      const finalSettings = await apiService.saveSettings({ isGoogleDriveConnected: false }); // Ensure state is correct
      setSettings(finalSettings);
      console.error("Google Drive connection failed:", error);
      alert(`Failed to connect to Google Drive: ${error instanceof Error ? error.message : String(error)}`);
      throw error; // Re-throw to keep modal open
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
    const updatedClient = await apiService.updateClient(clientId, { googleDriveFolderUrl: url });
    setClients(prev => prev.map(c => c.id === clientId ? updatedClient : c));
  }, []);

  const handleSetSyncInterval = useCallback(async (clientId: string, interval: number | 'MANUAL') => {
    const updatedClient = await apiService.updateClient(clientId, { syncInterval: interval });
    setClients(prev => prev.map(c => c.id === clientId ? updatedClient : c));
  }, []);
  
  const handleAddTag = useCallback(async (clientId: string, tagName: string) => {
    const updatedClient = await apiService.addTagToClient(clientId, tagName);
    setClients(prev => prev.map(c => c.id === clientId ? updatedClient : c));
  }, []);
  
  const handleRemoveTag = useCallback(async (clientId: string, tagId: string) => {
    const updatedClient = await apiService.removeTagFromClient(clientId, tagId);
    setClients(prev => prev.map(c => c.id === clientId ? updatedClient : c));
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!selectedClient) {
        return "No client selected.";
    }
    if (!settings?.fileSearchServiceApiKey) {
        return "Error: File Search Service API Key is not configured in Settings.";
    }

    try {
        // Sync data source on-demand before every search to ensure data is fresh.
        const result = await apiService.syncDataSource(selectedClient.id);
         if (result.status === 'changed') {
            setClients(prev => prev.map(c => c.id === selectedClient.id ? result.client : c));
        }
    } catch (error) {
        console.error("Sync failed during search operation:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to sync latest data before searching.";
        throw new Error(errorMessage);
    }
    
    return await fileSearchService.query(selectedClient, query, settings.fileSearchServiceApiKey);
  }, [selectedClient, settings]);

  if (isLoading) {
    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-center">
            <DriveIcon className="w-16 h-16 text-blue-500 animate-pulse mb-4" />
            <h2 className="text-2xl font-semibold text-white">Connecting to server...</h2>
            <p className="text-gray-400 mt-2">Loading your data sync workspace.</p>
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
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
          />
          <ClientManager 
            clients={clients} 
            selectedClientId={selectedClientId}
            onAddClient={handleAddClient} 
            onSelectClient={handleSelectClient} 
          />
          {selectedClient && (
            <FileManager 
              client={selectedClient}
              isGoogleDriveConnected={!!settings?.isGoogleDriveConnected}
              onSetFolderUrl={handleSetFolderUrl}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onSetSyncInterval={handleSetSyncInterval}
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
                    <p className="text-gray-400 mt-2">Configure your settings and add a data source to begin.</p>
                </div>
            )}
        </section>
      </main>

      <footer className="text-center py-2 text-xs text-gray-600 border-t border-gray-800">
        <p>v1.0.4</p>
      </footer>

      {isAuthModalOpen && settings && (
        <GoogleAuthModal 
            onClose={() => setIsAuthModalOpen(false)}
            initialSettings={settings}
            onConnect={handleConnectGoogleDrive}
            isConnected={!!settings.isGoogleDriveConnected}
        />
      )}
    </div>
  );
};

export default App;