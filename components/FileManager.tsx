import React, { useState, useEffect } from 'react';
import { Client, SyncedFile, Tag } from '../types.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';
import { CheckIcon } from './icons/CheckIcon.tsx';
import { RefreshIcon } from './icons/RefreshIcon.tsx';

interface FileManagerProps {
  client: Client;
  isGoogleDriveConnected: boolean;
  onSetFolderUrl: (clientId: string, url: string) => Promise<void>;
  onAddTag: (clientId: string, tagName: string) => void;
  onRemoveTag: (clientId: string, tagId: string) => void;
  onSetSyncInterval: (clientId: string, interval: number | 'MANUAL') => void;
  onSyncNow: (clientId: string) => Promise<void>;
  isSyncing: boolean;
}

const statusIndicator = (status: SyncedFile['status']) => {
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
    onSetSyncInterval,
    onSyncNow,
    isSyncing,
}) => {
  const [folderUrl, setFolderUrl] = useState(client.googleDriveFolderUrl || '');
  const [newTagName, setNewTagName] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [saveUrlSuccess, setSaveUrlSuccess] = useState(false);

  useEffect(() => {
    setFolderUrl(client.googleDriveFolderUrl || '');
    setSaveUrlSuccess(false);
  }, [client.googleDriveFolderUrl, client.id]);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingUrl || isSyncing) return;

    setIsSavingUrl(true);
    setSaveUrlSuccess(false);
    try {
      const trimmedUrl = folderUrl.trim();
      await onSetFolderUrl(client.id, trimmedUrl);
      setSaveUrlSuccess(true);
      setTimeout(() => setSaveUrlSuccess(false), 2500);
      if (trimmedUrl) {
          await onSyncNow(client.id);
      }
    } catch (error) {
        console.error("Failed to save folder URL or sync", error);
    } finally {
        setIsSavingUrl(false);
    }
  };
  
  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
        onAddTag(client.id, newTagName.trim());
        setNewTagName('');
    }
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const interval = value === 'MANUAL' ? 'MANUAL' : parseInt(value, 10);
    onSetSyncInterval(client.id, interval);
  };

  const renderContent = () => {
    if (!isGoogleDriveConnected) {
        return <p className="text-gray-500 text-sm text-center py-4">Please connect to Google Drive in Settings first.</p>;
    }

    const hasUnchangedUrl = folderUrl.trim() === (client.googleDriveFolderUrl || '');

    return (
        <>
            <form onSubmit={handleUrlSubmit} className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={folderUrl}
                    onChange={(e) => setFolderUrl(e.target.value)}
                    placeholder="Paste Google Drive folder URL"
                    className="flex-grow bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                    disabled={isSyncing}
                />
                <button 
                    type="submit" 
                    className={`font-bold py-2 px-3 rounded-md transition-colors text-sm flex justify-center items-center w-24
                        ${saveUrlSuccess
                            ? 'bg-green-600 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }
                        disabled:bg-gray-600 disabled:cursor-not-allowed`}
                    disabled={isSavingUrl || isSyncing || hasUnchangedUrl}
                >
                    {isSavingUrl ? (
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : saveUrlSuccess ? (
                        <span className="flex items-center gap-1">
                            <CheckIcon className="w-5 h-5" />
                            Saved
                        </span>
                    ) : 'Save'}
                </button>
            </form>

            <div className="border-t border-gray-700 pt-4 mt-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-semibold text-gray-300">Sync Settings</h3>
                    <button 
                        onClick={() => onSyncNow(client.id)}
                        disabled={isSyncing || !client.googleDriveFolderUrl}
                        className="text-xs bg-gray-600 hover:bg-gray-500 text-white font-semibold py-1 px-3 rounded-md transition-colors disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                        {isSyncing ? (
                            <>
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Syncing...</span>
                            </>
                        ) : (
                            <>
                                <RefreshIcon className="w-4 h-4" />
                                <span>Sync Now</span>
                            </>
                        )}
                    </button>
                </div>
                <label htmlFor="sync-interval" className="block text-sm font-medium text-gray-400 mb-1">
                    Auto-Sync Frequency
                </label>
                <select
                    id="sync-interval"
                    value={client.syncInterval}
                    onChange={handleIntervalChange}
                    className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600 disabled:opacity-50"
                    disabled={!client.googleDriveFolderUrl || isSyncing}
                >
                    <option value="MANUAL">Manual (On Search)</option>
                    <option value={5000}>Every 5 seconds</option>
                    <option value={60000}>Every minute</option>
                    <option value={600000}>Every 10 minutes</option>
                    <option value={3600000}>Every hour</option>
                    <option value={7200000}>Every 2 hours</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                    Controls how often to automatically check Google Drive for file changes.
                </p>
            </div>
            
            <div className="border-t border-gray-700 pt-4 mt-4">
                 <h3 className="text-md font-semibold text-gray-300 mb-2">Synced Files</h3>
                 <div className="max-h-60 overflow-y-auto pr-1">
                    {isSyncing && client.syncedFiles.length === 0 && (
                        <p className="text-gray-500 text-sm text-center py-4">Syncing files from Google Drive...</p>
                    )}
                    {!isSyncing && client.syncedFiles.length === 0 && (
                         <p className="text-gray-500 text-sm text-center py-4">No files found. Link a folder and click "Sync Now".</p>
                    )}
                    {client.syncedFiles.length > 0 && (
                        <ul className="space-y-2">
                        {client.syncedFiles.map(file => (
                            <li key={file.id} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md text-sm">
                            <div className="flex items-center gap-2 truncate">
                                {statusIndicator(file.status)}
                                <a
                                  href={`https://drive.google.com/file/d/${file.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate text-gray-300 hover:text-blue-400 hover:underline"
                                  title={file.name}
                                >
                                  {file.name}
                                </a>
                            </div>
                            </li>
                        ))}
                        </ul>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-700 pt-4 mt-4">
                 <h3 className="text-md font-semibold text-gray-300 mb-2">Tags</h3>
                 <p className="text-xs text-gray-500 mb-3">Use tags to categorize and organize your clients' data sources.</p>
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
