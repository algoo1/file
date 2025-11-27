
import React, { useState, useEffect } from 'react';
import { Client, SyncedFile, Tag } from '../types.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';
import { EyeIcon } from './icons/EyeIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { SheetIcon } from './icons/SheetIcon.tsx';
import { DocumentIcon } from './icons/DocumentIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { RefreshIcon } from './icons/RefreshIcon.tsx';
import { ClockIcon } from './icons/ClockIcon.tsx';

interface FileManagerProps {
  client: Client;
  isGoogleDriveConnected: boolean;
  onSetFolderUrl: (clientId: string, url: string) => Promise<void>;
  onAddTag: (clientId: string, tagName: string) => void;
  onRemoveTag: (clientId: string, tagId: string) => void;
  onSyncNow: (clientId: string, forceResync?: boolean) => Promise<void>;
  onSyncFile?: (clientId: string, file: SyncedFile) => Promise<void>;
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

const formatDate = (isoString?: string) => {
    if (!isoString) return '-';
    try {
        return new Date(isoString).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return 'Invalid Date';
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

const FileTypeIcon: React.FC<{type: SyncedFile['type']; source: SyncedFile['source']}> = ({ type }) => {
    const className = "w-5 h-5 text-gray-400 mr-3 flex-shrink-0";
    
    switch (type) {
        case 'image': return <ImageIcon className={className} />;
        case 'sheet': return <SheetIcon className={className} />;
        case 'pdf': return <DocumentIcon className={className} />;
        default: return <DocumentIcon className={className} />;
    }
};

const GoogleDriveManager: React.FC<{
    client: Client;
    isSyncing: boolean;
    isGoogleDriveConnected: boolean;
    onSetFolderUrl: (clientId: string, url: string) => Promise<void>;
    onSyncNow: (clientId: string) => Promise<void>;
}> = ({ client, isSyncing, isGoogleDriveConnected, onSetFolderUrl, onSyncNow }) => {
    const [folderUrl, setFolderUrl] = useState(client.google_drive_folder_url || '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setFolderUrl(client.google_drive_folder_url || '');
    }, [client.google_drive_folder_url, client.id]);

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
                disabled={isSaving || isSyncing}
            >
                {isSaving ? 'Saving...' : 'Save & Sync'}
            </button>
        </form>
    );
}


const FileManager: React.FC<FileManagerProps> = ({ 
    client, 
    isGoogleDriveConnected, 
    onSetFolderUrl, 
    onAddTag,
    onRemoveTag,
    onSyncNow,
    onSyncFile,
    isSyncing,
}) => {
  const [newTagName, setNewTagName] = useState('');
  const [viewingFile, setViewingFile] = useState<SyncedFile | null>(null);
  const [syncingFileId, setSyncingFileId] = useState<string | null>(null);

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
        onAddTag(client.id, newTagName.trim());
        setNewTagName('');
    }
  };

  const handleSingleFileSync = async (file: SyncedFile) => {
      if (onSyncFile) {
          setSyncingFileId(file.id);
          await onSyncFile(client.id, file);
          setSyncingFileId(null);
      }
  };
  
  const hasDataSource = !!client.google_drive_folder_url;

  return (
    <>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg flex flex-col">
            <h2 className="text-lg font-semibold mb-3 text-white">Data Sources</h2>

            <details className="bg-gray-900/50 rounded-lg border border-gray-700 mb-3" open={!!client.google_drive_folder_url}>
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
            
            <div className="border-t border-gray-700 pt-4 mt-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-semibold text-gray-300 flex items-center gap-2">
                        Status & Sync
                        <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full flex items-center gap-1 font-normal">
                             <ClockIcon className="w-3 h-3" /> Auto (10s)
                        </span>
                    </h3>
                </div>
                
                <div className="flex gap-2 mb-3">
                    <button 
                        onClick={() => onSyncNow(client.id, false)}
                        disabled={isSyncing || !hasDataSource}
                        className="flex-grow text-xs bg-gray-600 hover:bg-gray-500 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button 
                        onClick={() => onSyncNow(client.id, true)}
                        disabled={isSyncing || !hasDataSource}
                        className="flex-grow text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-gray-500 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                        title="Force re-download and re-index all files. Use this to apply new AI features to old files."
                    >
                        Re-process All
                    </button>
                </div>
            </div>
            
            <div className="border-t border-gray-700 pt-4 mt-4">
                 <h3 className="text-md font-semibold text-gray-300 mb-2">Synced Data</h3>
                 <div className="max-h-60 overflow-y-auto pr-1 space-y-3">
                    
                    {/* Google Drive Section */}
                    {client.google_drive_folder_url && (
                       <details className="bg-gray-900/50 rounded-lg border border-gray-700" open>
                             <summary className="p-2 cursor-pointer font-semibold text-gray-300 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <DriveIcon className="w-5 h-5 text-blue-400" />
                                    <span>Google Drive Files</span>
                                </div>
                            </summary>
                            <div className="p-2 border-t border-gray-700">
                                {(() => {
                                    const driveFiles = client.synced_files.filter(f => f.source === 'GOOGLE_DRIVE');
                                    
                                    if (driveFiles.length === 0) {
                                        return <p className="text-gray-500 text-sm text-center py-2">No files synced yet. Waiting for auto-sync...</p>;
                                    }
                                    return (
                                        <ul className="space-y-2">
                                            {driveFiles.map(file => (
                                                <li key={file.id} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md text-sm">
                                                    <div className="flex items-center min-w-0">
                                                        <FileTypeIcon type={file.type} source={file.source} />
                                                        <div className="truncate">
                                                            <span className="text-gray-300 block truncate" title={file.name}>{file.name}</span>
                                                            <span className="text-xs text-gray-500 block truncate">{file.status_message || file.status}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <button 
                                                            onClick={() => handleSingleFileSync(file)}
                                                            className={`p-1.5 rounded-full hover:bg-gray-600 text-gray-400 hover:text-blue-400 transition-colors ${syncingFileId === file.id ? 'animate-spin text-blue-400' : ''}`} 
                                                            title="Sync this file only"
                                                            disabled={isSyncing}
                                                        >
                                                            <RefreshIcon className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => setViewingFile(file)} className={`ml-1 p-1 rounded-full hover:bg-gray-600 ${statusIndicatorClasses(file.status)}`} title="View Status Details">
                                                            <EyeIcon className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    );
                                })()}
                           </div>
                       </details>
                    )}

                    {/* General Empty State */}
                    {!client.google_drive_folder_url && (
                        <p className="text-gray-500 text-sm text-center py-4">No data sources connected.</p>
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
                        <div className="bg-gray-900/50 p-3 rounded-md border border-gray-700 mb-4">
                            <p className="font-semibold text-gray-400 text-xs uppercase tracking-wider mb-1">Update Status</p>
                             {viewingFile.status_message ? (
                                <p className={`text-sm ${viewingFile.status_message.includes('successfully') ? 'text-green-400' : 'text-gray-200'}`}>
                                    {viewingFile.status_message}
                                </p>
                             ) : (
                                 <p className="text-sm text-gray-500">No update information available.</p>
                             )}
                        </div>

                        <div>
                            <p className="font-semibold text-gray-400">Name / ID</p>
                            <p className="text-gray-200 break-all font-medium">{viewingFile.name}</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="font-semibold text-gray-400">Current Status</p>
                                <p className={`font-semibold capitalize ${statusIndicatorClasses(viewingFile.status)}`}>{viewingFile.status}</p>
                            </div>
                            <div>
                                <p className="font-semibold text-gray-400">Source</p>
                                <p className="text-gray-200">{viewingFile.source === 'GOOGLE_DRIVE' ? 'Google Drive' : viewingFile.source}</p>
                            </div>
                        </div>

                        {viewingFile.source_modified_at && (
                             <div>
                                <p className="font-semibold text-gray-400">Last Modified</p>
                                <p className="text-gray-200 font-mono text-xs">{formatDate(viewingFile.source_modified_at)}</p>
                            </div>
                        )}
                        <div>
                            <p className="font-semibold text-gray-400">Last System Sync</p>
                            <p className="text-gray-200 font-mono text-xs">{formatDate(viewingFile.last_synced_at)}</p>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </>
  );
};

export default FileManager;
