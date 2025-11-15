
import React, { useState, useEffect } from 'react';
import { Client, FileObject } from '../types.ts';

interface FileManagerProps {
  client: Client;
  isGoogleDriveConnected: boolean;
  onSetFolderUrl: (clientId: string, url: string) => void;
  isSyncing: boolean;
  syncError: string | null;
}

const statusIndicator = (status: FileObject['status']) => {
    switch (status) {
        case 'syncing':
            return <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" title="Syncing..."></div>;
        case 'indexing':
            return <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" title="Indexing..."></div>;
        case 'indexed':
            return <div className="w-3 h-3 bg-green-500 rounded-full" title="Indexed"></div>;
        case 'error':
            return <div className="w-3 h-3 bg-red-500 rounded-full" title="Error"></div>;
        default:
            return <div className="w-3 h-3 bg-gray-500 rounded-full" title="Idle"></div>;
    }
}

const FileManager: React.FC<FileManagerProps> = ({ client, isGoogleDriveConnected, onSetFolderUrl, isSyncing, syncError }) => {
  const [folderUrl, setFolderUrl] = useState(client.googleDriveFolderUrl || '');

  useEffect(() => {
    setFolderUrl(client.googleDriveFolderUrl || '');
  }, [client.googleDriveFolderUrl]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSetFolderUrl(client.id, folderUrl);
  };
  
  const renderContent = () => {
    if (!isGoogleDriveConnected) {
        return <p className="text-gray-500 text-sm text-center py-4">Please connect to Google Drive in Settings first.</p>;
    }

    return (
        <>
            <form onSubmit={handleUrlSubmit} className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={folderUrl}
                    onChange={(e) => setFolderUrl(e.target.value)}
                    placeholder="Paste Google Drive folder URL"
                    className="flex-grow bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                />
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded-md transition-colors text-sm">
                    Link
                </button>
            </form>
             
             <div className="flex items-center gap-2 mb-2 text-sm">
                {isSyncing ? (
                    <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-gray-400">Syncing...</span>
                    </>
                ) : (
                     <span className="text-gray-500">Watching for changes...</span>
                )}
             </div>
             {syncError && <p className="text-xs text-red-400 mb-2">{syncError}</p>}
            
            <div className="max-h-60 overflow-y-auto pr-1">
                {client.files.length > 0 ? (
                    <ul className="space-y-2">
                    {client.files.map(file => (
                        <li key={file.id} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md text-sm">
                        <div className="flex items-center gap-2 truncate">
                            {statusIndicator(file.status)}
                            <span className="truncate" title={file.name}>{file.name}</span>
                        </div>
                        </li>
                    ))}
                    </ul>
                ) : (
                    <p className="text-gray-500 text-sm text-center py-4">No files found in linked folder, or folder not linked yet.</p>
                )}
            </div>
        </>
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg flex flex-col">
      <h2 className="text-lg font-semibold mb-3 text-white">Data Sources (Google Drive)</h2>
      {renderContent()}
    </div>
  );
};

export default FileManager;