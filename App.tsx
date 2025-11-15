import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Client } from './types.ts';
import { googleApiService } from './services/googleApiService.ts';
import { googleDriveService } from './services/googleDriveService.ts';
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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  
  const [fileSearchApiKey, setFileSearchApiKey] = useState<string>('');
  const [googleApiKey, setGoogleApiKey] = useState<string>('');
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [googleClientSecret, setGoogleClientSecret] = useState<string>('');
  
  const [isGoogleDriveConnected, setIsGoogleDriveConnected] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [apiScriptsLoaded, setApiScriptsLoaded] = useState(false);
  
  const pollingIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    googleApiService.loadScripts().then(() => {
        setApiScriptsLoaded(true);
        console.log("Google API scripts loaded successfully.");
    }).catch(error => {
        console.error("Failed to load Google API scripts:", error);
        alert("Could not load necessary Google scripts. Please check your internet connection and refresh the page.");
    });
  }, []);

  const handleConnectGoogleDrive = useCallback(async () => {
    if (!googleApiKey || !googleClientId) {
      alert("Please provide both Google API Key and Client ID in settings.");
      return;
    }
    try {
      await googleDriveService.connect(googleApiKey, googleClientId);
      setIsGoogleDriveConnected(true);
      setIsAuthModalOpen(false); // Close modal on success
    } catch (error) {
      console.error("Google Drive connection failed:", error);
      alert(`Failed to connect to Google Drive: ${error instanceof Error ? error.message : String(error)}`);
      setIsGoogleDriveConnected(false);
    }
  }, [googleApiKey, googleClientId]);

  const handleAddClient = useCallback((name: string) => {
    if (name.trim()) {
      const newClient: Client = {
        id: `client_${Date.now()}`,
        name,
        files: [],
        apiKey: `key_${crypto.randomUUID()}`,
        googleDriveFolderUrl: null,
      };
      setClients(prev => [...prev, newClient]);
      setSelectedClientId(newClient.id);
    }
  }, []);

  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
  }, []);

  const handleSetFolderUrl = useCallback((clientId: string, url: string) => {
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, googleDriveFolderUrl: url } : c));
  }, []);

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  useEffect(() => {
    if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
    }

    const syncAndPoll = async () => {
        if (!selectedClient || !selectedClient.googleDriveFolderUrl || !isGoogleDriveConnected || !fileSearchApiKey.trim()) {
            setIsSyncing(false);
            return;
        }

        setIsSyncing(true);
        setSyncError(null);
        console.log(`Checking for updates for ${selectedClient.name}...`);
        
        try {
            const driveFiles = await googleDriveService.getFilesFromFolder(selectedClient.googleDriveFolderUrl);
            const currentContent = selectedClient.files.map(f => f.id + f.content).join('');
            const newContent = driveFiles.map(f => f.id + f.content).join('');

            if (currentContent !== newContent) {
                console.log("Change detected! Starting full sync.");
                setClients(prev => prev.map(c => 
                    c.id === selectedClient.id 
                        ? { ...c, files: driveFiles.map(df => ({...df, summary: '...', status: 'syncing'})) }
                        : c
                ));
                
                const indexedFiles = await fileSearchService.syncClientFiles(selectedClient, driveFiles, fileSearchApiKey);
                
                setClients(prev => prev.map(c => c.id === selectedClient.id ? { ...c, files: indexedFiles } : c));
                console.log("Sync successful.");
            } else {
                console.log("No changes detected.");
            }
        } catch (error) {
            console.error("Sync failed:", error);
            setSyncError(error instanceof Error ? error.message : "An unknown error occurred during sync.");
        } finally {
            setIsSyncing(false);
        }
    };
    
    if (selectedClient && selectedClient.googleDriveFolderUrl) {
        syncAndPoll();
        pollingIntervalRef.current = window.setInterval(syncAndPoll, 5000);
    }

    return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }
    };
  }, [selectedClient, isGoogleDriveConnected, fileSearchApiKey]);

  const handleSearch = useCallback(async (query: string) => {
    if (!selectedClient) return "No client selected.";
    return await fileSearchService.query(selectedClient, query, fileSearchApiKey);
  }, [selectedClient, fileSearchApiKey]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans">
      <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
            <DriveIcon className="w-8 h-8 text-blue-400" />
            <h1 className="text-xl md:text-2xl font-bold text-white">Drive Data Sync & Search API</h1>
        </div>
      </header>
      
      <main className="flex flex-col md:flex-row gap-6 p-4 md:p-6">
        <aside className="w-full md:w-1/3 lg:w-1/4 flex flex-col gap-6">
          <Settings 
            fileSearchApiKey={fileSearchApiKey}
            setFileSearchApiKey={setFileSearchApiKey}
            isGoogleDriveConnected={isGoogleDriveConnected}
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
              isGoogleDriveConnected={isGoogleDriveConnected}
              onSetFolderUrl={handleSetFolderUrl}
              isSyncing={isSyncing}
              syncError={syncError}
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
                    <p className="text-gray-400 mt-2">Configure your settings and add a client to begin.</p>
                </div>
            )}
        </section>
      </main>
      {isAuthModalOpen && (
        <GoogleAuthModal 
            onClose={() => setIsAuthModalOpen(false)}
            googleApiKey={googleApiKey}
            setGoogleApiKey={setGoogleApiKey}
            googleClientId={googleClientId}
            setGoogleClientId={setGoogleClientId}
            googleClientSecret={googleClientSecret}
            setGoogleClientSecret={setGoogleClientSecret}
            onConnectGoogleDrive={handleConnectGoogleDrive}
            isGoogleDriveConnected={isGoogleDriveConnected}
            apiScriptsLoaded={apiScriptsLoaded}
        />
      )}
    </div>
  );
};

export default App;