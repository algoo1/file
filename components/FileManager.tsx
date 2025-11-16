import React, { useState, useEffect } from 'react';
import { Client, FileObject, Tag } from '../database/schema.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';

interface FileManagerProps {
  client: Client;
  isGoogleDriveConnected: boolean;
  onSetFolderUrl: (clientId: string, url: string) => void;
  onAddTag: (clientId: string, tagName: string) => void;
  onRemoveTag: (clientId: string, tagId: string) => void;
  isSyncing: boolean;
  syncError: string | null;
}

const statusIndicator = (status: FileObject['status']) => {
    switch (status) {
        case 'SYNCING':
            return <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" title="Syncing..."></div>;
        case 'INDEXING':
            return <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" title="Indexing..."></div>;
        case 'COMPLETED':
            return <div className="w-3 h-3 bg-green-500 rounded-full" title="Indexed"></div>;
        case 'FAILED':
            return <div className="w-3 h-3 bg-red-500 rounded-full" title="Error"></div>;
        default:
            return <div className="w-3 h-3 bg-gray-500 rounded-full" title="Idle"></div>;
    }
}

const TagPill: React.FC<{tag: Tag; onRemove: (tagId: string) => void}> = ({ tag, onRemove }) => (
    <div className="flex items-center bg-gray-600 text-gray-200 text-xs font-semibold px-2 py-1 rounded-full">
        <span>{tag.name}</span>
        <button onClick={() => onRemove(tag.id)} className="ml-1.5 text-gray-400 hover:text-white">
            &times;
        </button>
    </div>
);

const FileManager: React.FC<FileManagerProps> = ({ 
    client, 
    isGoogleDriveConnected, 
    onSetFolderUrl, 
    onAddTag,
    onRemoveTag,
    isSyncing, 
    syncError 
}) => {
  const [folderUrl, setFolderUrl] = useState(client.googleDriveFolderUrl || '');
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    setFolderUrl(client.googleDriveFolderUrl || '');
  }, [client.googleDriveFolderUrl]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSetFolderUrl(client.id, folderUrl);
  };
  
  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
        onAddTag(client.id, newTagName.trim());
        setNewTagName('');
    }
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
                {client.syncedFiles.length > 0 ? (
                    <ul className="space-y-2">
                    {client.syncedFiles.map(file => (
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

            <div className="border-t border-gray-700 pt-4 mt-4">
                 <h3 className="text-md font-semibold text-gray-300 mb-3">Tags</h3>
                 <div className="flex flex-wrap gap-2 mb-3">
                    {client.tags.map(tag => (
                        <TagPill key={tag.id} tag={tag} onRemove={() => onRemoveTag(client.id, tag.id)} />
                    ))}
                 </div>
                 <form onSubmit={handleAddTag} className="flex gap-2">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Add a tag..."
                      className="flex-grow bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                    />
                    <button type="submit" className="bg-gray-600 hover:bg-gray-500 text-white font-bold p-2 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed" disabled={!newTagName.trim()}>
                        <PlusIcon className="w-5 h-5" />
                    </button>
                </form>
            </div>
        </>
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg flex flex-col">
      <h2 className="text-lg font-semibold mb-3 text-white">Data Source Details</h2>
      {renderContent()}
    </div>
  );
};

export default FileManager;