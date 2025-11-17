import React, { useState, useEffect } from 'react';
import { Client, SyncedFile, Tag } from '../types.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';
import { CheckIcon } from './icons/CheckIcon.tsx';
import { EyeIcon } from './icons/EyeIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { SheetIcon } from './icons/SheetIcon.tsx';
import { DocumentIcon } from './icons/DocumentIcon.tsx';
import { AirtableIcon } from './icons/AirtableIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';


interface FileManagerProps {
  client: Client;
  isGoogleDriveConnected: boolean;
  isAirtableSetUp: boolean;
  onSetFolderUrl: (clientId: string, url: string) => Promise<void>;
  onSetAirtableDetails: (clientId: string, details: Partial<Client>) => Promise<void>;
  onInitiateAirtableOAuth: (clientId: string) => void;
  onAddTag: (clientId: string, tagName: string) => void;
  onRemoveTag: (clientId: string, tagId: string) => void;
  onSetSyncInterval: (clientId: string, interval: number | 'MANUAL') => void;
  onSyncNow: (clientId: string) => Promise<void>;
  isSyncing: boolean;
}

const statusIndicatorClasses = (status: SyncedFile['status']) => {
    switch (status) {
        case 'SYNCING':
            return 'text-blue-500 animate-pulse';
        case 'INDEXING':
            return 'text-yellow-500 animate-pulse';
        case 'COMPLETED':
            return 'text-green-500';
        case 'FAILED':
            return 'text-red-500';
        default:
            return 'text-gray-500';
    }
};

const TagPill: React.FC<{tag: Tag; onRemove: (tagId: string) => void}> = ({ tag, onRemove }) => (
    <div className="flex items-center bg-gray-600 text-gray-200 text-xs font-semibold px-2 py-1 rounded-full">
        <span>{tag.name}</span>
        <button onClick={() => onRemove(tag.id)} className="ml-1.5 text-gray-400 hover:text-white">
            &times;
        </button>
    </div>
);

const FileTypeIcon: React.FC<{type: SyncedFile['type']; source: SyncedFile['source']}> = ({ type, source }) => {
    const className = "w-5 h-5 text-gray-400 mr-3 flex-shrink-0";
    if (source === 'AIRTABLE') return <AirtableIcon className={className} />;
    
    switch (type) {
        case 'image': return <ImageIcon className={className} />;
        case 'sheet': return <SheetIcon className={className} />;
        case 'pdf': return <DocumentIcon className={className} />;
        case 'record': return <AirtableIcon className={className} />; // Fallback for airtable
        default: return null;
    }
};


const GoogleDriveManager: React.FC<{
    client: Client;
    isSyncing: boolean;
    isGoogleDriveConnected: boolean;
    onSetFolderUrl: (clientId: string, url: string) => Promise<void>;
    onSyncNow: (clientId: string) => Promise<void>;
}> = ({ client, isSyncing, isGoogleDriveConnected, onSetFolderUrl, onSyncNow }) => {
    const [folderUrl, setFolderUrl] = useState(client.googleDriveFolderUrl || '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setFolderUrl(client.googleDriveFolderUrl || '');
    }, [client.googleDriveFolderUrl, client.id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving || isSyncing) return;
        setIsSaving(true);
        try {
            const trimmedUrl = folderUrl.trim();
            await onSetFolderUrl(client.id, trimmedUrl);
            if (trimmedUrl) {
                await onSyncNow(client.id);
            }
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!isGoogleDriveConnected) {
        return <p className="text-gray-500 text-sm text-center py-4">Connect to Google Drive in Settings to enable this data source.</p>;
    }

    const hasUnchangedUrl = folderUrl.trim() === (client.googleDriveFolderUrl || '');

    return (
        <form onSubmit={handleSubmit} className="flex gap-2">
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
                className="font-bold py-2 px-3 rounded-md transition-colors text-sm flex justify-center items-center w-24 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-600 disabled:cursor-not-allowed"
                disabled={isSaving || isSyncing || hasUnchangedUrl}
            >
                {isSaving ? 'Saving...' : 'Save & Sync'}
            </button>
        </form>
    );
}

const AirtableManager: React.FC<{
    client: Client;
    isSyncing: boolean;
    isAirtableSetUp: boolean;
    onSetAirtableDetails: (clientId: string, details: Partial<Client>) => Promise<void>;
    onInitiateAirtableOAuth: (clientId: string) => void;
    onSyncNow: (clientId: string) => Promise<void>;
}> = ({ client, isSyncing, isAirtableSetUp, onSetAirtableDetails, onInitiateAirtableOAuth, onSyncNow }) => {
    const [apiKey, setApiKey] = useState(client.airtableApiKey || '');
    const [baseId, setBaseId] = useState(client.airtableBaseId || '');
    const [tableId, setTableId] = useState(client.airtableTableId || '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setApiKey(client.airtableApiKey || '');
        setBaseId(client.airtableBaseId || '');
        setTableId(client.airtableTableId || '');
    }, [client.id, client.airtableApiKey, client.airtableBaseId, client.airtableTableId]);

    const handlePatSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving || isSyncing) return;
        setIsSaving(true);
        try {
            const details = { 
                airtableApiKey: apiKey.trim(), 
                airtableBaseId: baseId.trim(), 
                airtableTableId: tableId.trim(),
                // Clear OAuth tokens if switching to PAT
                airtableAccessToken: null,
                airtableRefreshToken: null,
                airtableTokenExpiresAt: null,
            };
            await onSetAirtableDetails(client.id, details);
             if (details.airtableApiKey && details.airtableBaseId && details.airtableTableId) {
                await onSyncNow(client.id);
            }
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!isAirtableSetUp) {
        return <p className="text-gray-500 text-sm text-center py-4">Set up Airtable integration in Settings to enable this data source.</p>;
    }

    const hasPatUnchangedDetails = apiKey.trim() === (client.airtableApiKey || '') 
        && baseId.trim() === (client.airtableBaseId || '') 
        && tableId.trim() === (client.airtableTableId || '');
    
    const canSavePat = !hasPatUnchangedDetails && apiKey && baseId && tableId;
    const isConnectedViaOAuth = !!client.airtableAccessToken;

    const handleOAuthConnect = async () => {
        // First, save any changes to base/table IDs
        if (baseId.trim() !== (client.airtableBaseId || '') || tableId.trim() !== (client.airtableTableId || '')) {
            await onSetAirtableDetails(client.id, { airtableBaseId: baseId.trim(), airtableTableId: tableId.trim() });
        }
        onInitiateAirtableOAuth(client.id);
    };

    return (
        <div className="space-y-3">
            <button 
                type="button"
                onClick={handleOAuthConnect}
                disabled={isSyncing || !baseId || !tableId}
                className={`w-full font-bold py-2 px-3 rounded-md transition-colors text-sm flex justify-center items-center gap-2
                    ${isConnectedViaOAuth ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}
                    disabled:bg-gray-600 disabled:cursor-not-allowed`}
            >
                <AirtableIcon className="w-5 h-5" />
                {isConnectedViaOAuth ? 'Airtable Connected' : 'Connect with Airtable (OAuth)'}
            </button>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={baseId}
                    onChange={(e) => setBaseId(e.target.value)}
                    placeholder="Airtable Base ID"
                    className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                    disabled={isSyncing}
                />
                <input
                    type="text"
                    value={tableId}
                    onChange={(e) => setTableId(e.target.value)}
                    placeholder="Airtable Table ID or Name"
                    className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                    disabled={isSyncing}
                />
            </div>
            <p className="text-xs text-gray-500 text-center">Enter Base and Table ID, then connect.</p>

            <details className="pt-2">
                <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer text-center">
                    Connect using a Personal Access Token instead
                </summary>
                <form onSubmit={handlePatSubmit} className="space-y-3 mt-3">
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Airtable Personal Access Token"
                        className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                        disabled={isSyncing}
                    />
                    <button 
                        type="submit" 
                        className="w-full font-bold py-2 px-3 rounded-md transition-colors text-sm flex justify-center items-center bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-600 disabled:cursor-not-allowed"
                        disabled={isSaving || isSyncing || !canSavePat}
                    >
                        {isSaving ? 'Saving...' : 'Save & Sync with Token'}
                    </button>
                </form>
            </details>
        </div>
    );
};


const FileManager: React.FC<FileManagerProps> = ({ 
    client, 
    isGoogleDriveConnected, 
    isAirtableSetUp,
    onSetFolderUrl, 
    onSetAirtableDetails,
    onInitiateAirtableOAuth,
    onAddTag,
    onRemoveTag,
    onSetSyncInterval,
    onSyncNow,
    isSyncing,
}) => {
  const [newTagName, setNewTagName] = useState('');
  const [viewingFile, setViewingFile] = useState<SyncedFile | null>(null);

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
  
  const hasDataSource = client.googleDriveFolderUrl || 
                        (client.airtableApiKey && client.airtableBaseId && client.airtableTableId) ||
                        (client.airtableAccessToken && client.airtableBaseId && client.airtableTableId);

  return (
    <>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg flex flex-col">
            <h2 className="text-lg font-semibold mb-3 text-white">Data Sources</h2>

            <details className="bg-gray-900/50 rounded-lg border border-gray-700 mb-3" open={!!client.googleDriveFolderUrl}>
                <summary className="p-3 cursor-pointer font-semibold text-gray-200 flex items-center gap-2">
                    <DriveIcon className="w-5 h-5 text-blue-400" />
                    Google Drive
                </summary>
                <div className="p-3 border-t border-gray-700">
                   <GoogleDriveManager 
                        client={client} 
                        isSyncing={isSyncing} 
                        isGoogleDriveConnected={isGoogleDriveConnected} 
                        onSetFolderUrl={onSetFolderUrl} 
                        onSyncNow={onSyncNow} 
                    />
                </div>
            </details>
            
            <details className="bg-gray-900/50 rounded-lg border border-gray-700" open={!!client.airtableBaseId}>
                <summary className="p-3 cursor-pointer font-semibold text-gray-200 flex items-center gap-2">
                    <AirtableIcon className="w-5 h-5 text-yellow-400" />
                    Airtable
                </summary>
                <div className="p-3 border-t border-gray-700">
                    <AirtableManager 
                        client={client} 
                        isSyncing={isSyncing}
                        isAirtableSetUp={isAirtableSetUp}
                        onSetAirtableDetails={onSetAirtableDetails}
                        onInitiateAirtableOAuth={onInitiateAirtableOAuth}
                        onSyncNow={onSyncNow} 
                    />
                </div>
            </details>


            <div className="border-t border-gray-700 pt-4 mt-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-semibold text-gray-300">Sync Settings</h3>
                    <button 
                        onClick={() => onSyncNow(client.id)}
                        disabled={isSyncing || !hasDataSource}
                        className="text-xs bg-gray-600 hover:bg-gray-500 text-white font-semibold py-1 px-3 rounded-md transition-colors disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
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
                    disabled={!hasDataSource || isSyncing}
                >
                    <option value="MANUAL">Manual (On Search)</option>
                    <option value={5000}>Every 5 seconds</option>
                    <option value={60000}>Every minute</option>
                    <option value={600000}>Every 10 minutes</option>
                    <option value={3600000}>Every hour</option>
                    <option value={7200000}>Every 2 hours</option>
                </select>
            </div>
            
            <div className="border-t border-gray-700 pt-4 mt-4">
                 <h3 className="text-md font-semibold text-gray-300 mb-2">Synced Files</h3>
                 <div className="max-h-60 overflow-y-auto pr-1">
                    {isSyncing && client.syncedFiles.length === 0 && (
                        <p className="text-gray-500 text-sm text-center py-4">Syncing data...</p>
                    )}
                    {!isSyncing && client.syncedFiles.length === 0 && (
                         <p className="text-gray-500 text-sm text-center py-4">No files found. Connect a source and click "Sync Now".</p>
                    )}
                    {client.syncedFiles.length > 0 && (
                        <ul className="space-y-2">
                        {client.syncedFiles.map(file => (
                            <li key={file.id} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md text-sm">
                                <div className="flex items-center min-w-0">
                                    <FileTypeIcon type={file.type} source={file.source} />
                                    <span className="truncate text-gray-300" title={file.name}>
                                        {file.name}
                                    </span>
                                </div>
                                <button onClick={() => setViewingFile(file)} className={`ml-2 p-1 rounded-full hover:bg-gray-600 ${statusIndicatorClasses(file.status)}`} title="View Status Details">
                                    <EyeIcon className="w-5 h-5" />
                                </button>
                            </li>
                        ))}
                        </ul>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-700 pt-4 mt-4">
                 <h3 className="text-md font-semibold text-gray-300 mb-2">Tags</h3>
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
        </div>

        {viewingFile && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 backdrop-blur-sm" onClick={() => setViewingFile(null)}>
                <div className="bg-gray-800 rounded-lg shadow-2xl p-6 border border-gray-700 w-full max-w-md" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-start mb-3">
                        <h3 className="text-lg font-semibold text-white">File Status Details</h3>
                        <button onClick={() => setViewingFile(null)} className="text-gray-400 hover:text-white text-2xl">&times;</button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <div>
                            <p className="font-semibold text-gray-400">Source</p>
                            <p className="text-gray-200">{viewingFile.source === 'GOOGLE_DRIVE' ? 'Google Drive' : 'Airtable'}</p>
                        </div>
                        <div>
                            <p className="font-semibold text-gray-400">Name / ID</p>
                            <p className="text-gray-200 break-all">{viewingFile.name}</p>
                        </div>
                         <div>
                            <p className="font-semibold text-gray-400">Status</p>
                            <p className={`font-semibold capitalize ${statusIndicatorClasses(viewingFile.status)}`}>{viewingFile.status}</p>
                        </div>
                        {viewingFile.statusMessage && (
                             <div>
                                <p className="font-semibold text-gray-400">Details</p>
                                <p className="text-gray-300 bg-gray-900/50 p-2 rounded-md whitespace-pre-wrap">{viewingFile.statusMessage}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
    </>
  );
};

export default FileManager;
