
import React, { useState, useEffect } from 'react';
import { Client, SyncedFile, Tag } from '../types.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';
import { EyeIcon } from './icons/EyeIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { SheetIcon } from './icons/SheetIcon.tsx';
import { DocumentIcon } from './icons/DocumentIcon.tsx';
import { AirtableIcon } from './icons/AirtableIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { CheckCircleIcon } from './icons/CheckCircleIcon.tsx';
import { XCircleIcon } from './icons/XCircleIcon.tsx';
import { ClockIcon } from './icons/ClockIcon.tsx';
import { RefreshIcon } from './icons/RefreshIcon.tsx';
import { apiService } from '../services/apiService.ts';

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

const AirtableManager: React.FC<{
    client: Client;
    isSyncing: boolean;
    isAirtableSetUp: boolean;
    onSetAirtableDetails: (clientId: string, details: Partial<Client>) => Promise<void>;
    onInitiateAirtableOAuth: (clientId: string) => void;
    onSyncNow: (clientId: string) => Promise<void>;
}> = ({ client, isSyncing, isAirtableSetUp, onSetAirtableDetails, onInitiateAirtableOAuth, onSyncNow }) => {
    const [apiKey, setApiKey] = useState(client.airtable_api_key || '');
    const [baseId, setBaseId] = useState(client.airtable_base_id || '');
    const [tableId, setTableId] = useState(client.airtable_table_id || '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setApiKey(client.airtable_api_key || '');
        setBaseId(client.airtable_base_id || '');
        setTableId(client.airtable_table_id || '');
    }, [client.id, client.airtable_api_key, client.airtable_base_id, client.airtable_table_id]);

    const handlePatSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving || isSyncing) return;
        setIsSaving(true);
        try {
            const details = { 
                airtable_api_key: apiKey.trim(), 
                airtable_base_id: baseId.trim(), 
                airtable_table_id: tableId.trim(),
                // Clear OAuth tokens if switching to PAT
                airtable_access_token: null,
                airtable_refresh_token: null,
                airtable_token_expires_at: null,
            };
            await onSetAirtableDetails(client.id, details);
             if (details.airtable_api_key && details.airtable_base_id && details.airtable_table_id) {
                await onSyncNow(client.id);
            }
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!isAirtableSetUp) {
        return <p className="text-gray-500 text-sm text-center py-4">Set up Airtable integration in Settings to enable this data source.</p>;
    }

    const canSavePat = apiKey && baseId && tableId;
    const isConnectedViaOAuth = !!client.airtable_access_token;

    const handleOAuthConnect = async () => {
        // First, save any changes to base/table IDs
        if (baseId.trim() !== (client.airtable_base_id || '') || tableId.trim() !== (client.airtable_table_id || '')) {
            await onSetAirtableDetails(client.id, { airtable_base_id: baseId.trim(), airtable_table_id: tableId.trim() });
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
    onSyncFile,
    isSyncing,
}) => {
  const [newTagName, setNewTagName] = useState('');
  const [viewingFile, setViewingFile] = useState<SyncedFile | null>(null);
  const [syncingFileId, setSyncingFileId] = useState<string | null>(null);
  const [isSpecificSyncing, setIsSpecificSyncing] = useState<string | null>(null);

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

  const handleSingleFileSync = async (file: SyncedFile) => {
      if (onSyncFile) {
          setSyncingFileId(file.id);
          await onSyncFile(client.id, file);
          setSyncingFileId(null);
      }
  };
  
  // Handler for sync source specific buttons
  const handleSpecificSync = async (source: 'GOOGLE_DRIVE' | 'AIRTABLE') => {
      if (isSyncing) return;
      setIsSpecificSyncing(source);
      try {
          await onSyncNow(client.id);
      } finally {
          setIsSpecificSyncing(null);
      }
  };
  
  const hasDataSource = client.google_drive_folder_url || 
                        (client.airtable_api_key && client.airtable_base_id && client.airtable_table_id) ||
                        (client.airtable_access_token && client.airtable_base_id && client.airtable_table_id);

  const getAirtableAggregateStatus = (): { status: 'COMPLETED' | 'FAILED' | 'SYNCING' | 'IDLE', text: string, icon: React.ReactNode } => {
      const airtableRecords = client.synced_files.filter(f => f.source === 'AIRTABLE');
      const totalAirtableRecords = airtableRecords.length;

      if (isSyncing) {
          const processingRecords = airtableRecords.filter(r => r.status === 'SYNCING' || r.status === 'INDEXING');
          if (processingRecords.length > 0) {
              return { status: 'SYNCING', text: 'Updating records...', icon: <ClockIcon className="w-5 h-5 text-blue-500 animate-pulse" /> };
          }
      }
      
      if (airtableRecords.some(r => r.status === 'FAILED')) {
            return { status: 'FAILED', text: 'Sync failed', icon: <XCircleIcon className="w-5 h-5 text-red-500" /> };
      }

      if (totalAirtableRecords > 0 && airtableRecords.every(r => r.status === 'COMPLETED')) {
          const recordText = totalAirtableRecords === 1 ? 'record' : 'records';
          return { status: 'COMPLETED', text: `Synced (${totalAirtableRecords} ${recordText})`, icon: <CheckCircleIcon className="w-5 h-5 text-green-500" /> };
      }
      
      const isSyncFinished = !isSyncing && client.synced_files.length > 0 && client.synced_files.every(f => f.status === 'COMPLETED' || f.status === 'FAILED');
      if (isSyncFinished && totalAirtableRecords === 0) {
          return { status: 'COMPLETED', text: `Synced (0 records)`, icon: <CheckCircleIcon className="w-5 h-5 text-green-500" /> };
      }

      return { status: 'IDLE', text: 'Ready to Sync', icon: <ClockIcon className="w-5 h-5 text-gray-400" /> };
  }


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
            
            <details className="bg-gray-900/50 rounded-lg border border-gray-700" open={!!client.airtable_base_id}>
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
                </div>
                
                <div className="flex gap-2 mb-3">
                    <button 
                        onClick={() => onSyncNow(client.id, false)}
                        disabled={isSyncing || !hasDataSource}
                        className="flex-grow text-xs bg-gray-600 hover:bg-gray-500 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                        {isSyncing ? 'Syncing...' : 'Smart Sync (Update Changes)'}
                    </button>
                    <button 
                        onClick={() => onSyncNow(client.id, true)}
                        disabled={isSyncing || !hasDataSource}
                        className="flex-grow text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-gray-500 text-white font-semibold py-2 px-3 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                        title="Force re-download and re-index all files. Use this to apply new AI features to old files."
                    >
                        Re-process All (Fix Search)
                    </button>
                </div>

                <label htmlFor="sync-interval" className="block text-sm font-medium text-gray-400 mb-1">
                    Auto-Sync Frequency
                </label>
                <select
                    id="sync-interval"
                    value={client.sync_interval}
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
                 <h3 className="text-md font-semibold text-gray-300 mb-2">Synced Data</h3>
                 <div className="max-h-60 overflow-y-auto pr-1 space-y-3">
                    
                    {/* Airtable Section */}
                    {client.airtable_base_id && client.airtable_table_id && (
                        <details className="bg-gray-900/50 rounded-lg border border-gray-700" open>
                            <summary className="p-2 cursor-pointer font-semibold text-gray-300 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <AirtableIcon className="w-5 h-5 text-yellow-400" />
                                    <span>Airtable Data</span>
                                </div>
                                 <button 
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleSpecificSync('AIRTABLE');
                                    }}
                                    disabled={isSyncing}
                                    className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 px-2 py-0.5 rounded flex items-center gap-1 disabled:opacity-50"
                                    title="Sync Airtable Table Only"
                                >
                                    <RefreshIcon className="w-3 h-3" />
                                    Sync Table
                                </button>
                            </summary>
                            <div className="p-2 border-t border-gray-700">
                                <div className="bg-gray-700/50 p-2 rounded-md text-sm mb-2">
                                    <div className="flex items-center justify-between">
                                        <span className="truncate text-gray-300" title={client.airtable_table_id}>
                                            Table: {client.airtable_table_id}
                                        </span>
                                        {(() => {
                                            const { text, icon } = getAirtableAggregateStatus();
                                            return (
                                                <div className="flex items-center gap-2 text-gray-400" title={text}>
                                                    <span>{text}</span>
                                                    {icon}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                                {/* Individual Airtable Records List */}
                                {(() => {
                                    const airtableRecords = client.synced_files.filter(f => f.source === 'AIRTABLE');
                                    if (airtableRecords.length > 0) {
                                        return (
                                            <div className="space-y-1 mt-2">
                                                {/* Header Row */}
                                                <div className="grid grid-cols-12 gap-2 text-[10px] text-gray-500 px-2 font-semibold uppercase tracking-wider">
                                                    <div className="col-span-5">Record Name</div>
                                                    <div className="col-span-5">Last Modified</div>
                                                    <div className="col-span-2 text-right">Action</div>
                                                </div>
                                                
                                                <ul className="space-y-1">
                                                    {airtableRecords.map(file => (
                                                        <li key={file.id} className="grid grid-cols-12 gap-2 items-center bg-gray-800/50 p-2 rounded-md text-xs hover:bg-gray-700/50 transition-colors">
                                                            <span className="col-span-5 truncate text-gray-300 font-medium" title={file.name}>
                                                                {file.name}
                                                            </span>
                                                            <span className="col-span-5 text-gray-400 truncate font-mono text-[10px]" title={file.source_modified_at}>
                                                                 {formatDate(file.source_modified_at)}
                                                            </span>
                                                            <div className="col-span-2 flex justify-end items-center gap-1">
                                                                 <button 
                                                                    onClick={() => handleSingleFileSync(file)}
                                                                    className={`p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-blue-400 transition-colors ${syncingFileId === file.id ? 'animate-spin text-blue-400' : ''}`} 
                                                                    title="Sync this record"
                                                                    disabled={isSyncing}
                                                                >
                                                                    <RefreshIcon className="w-3 h-3" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setViewingFile(file)}
                                                                    className={`p-1 rounded hover:bg-gray-600 ${statusIndicatorClasses(file.status)}`}
                                                                    title="View Details & Status"
                                                                >
                                                                    <EyeIcon className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )
                                    } else if (!isSyncing) {
                                        return <p className="text-xs text-gray-500 p-2 text-center">No records found. Click Sync to pull data.</p>
                                    }
                                })()}
                            </div>
                        </details>
                    )}
                    
                    {/* Google Drive Section */}
                    {client.google_drive_folder_url && (
                       <details className="bg-gray-900/50 rounded-lg border border-gray-700" open>
                             <summary className="p-2 cursor-pointer font-semibold text-gray-300 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <DriveIcon className="w-5 h-5 text-blue-400" />
                                    <span>Google Drive Files</span>
                                </div>
                                 <button 
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleSpecificSync('GOOGLE_DRIVE');
                                    }}
                                    disabled={isSyncing}
                                    className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 px-2 py-0.5 rounded flex items-center gap-1 disabled:opacity-50"
                                    title="Sync Drive Folder Only"
                                >
                                    <RefreshIcon className="w-3 h-3" />
                                    Sync Folder
                                </button>
                            </summary>
                            <div className="p-2 border-t border-gray-700">
                                {(() => {
                                    const driveFiles = client.synced_files.filter(f => f.source === 'GOOGLE_DRIVE');
                                    
                                    if (isSyncing && driveFiles.length === 0) {
                                        return <p className="text-gray-500 text-sm text-center py-2">Scanning Google Drive for files...</p>;
                                    }
                                    if (!isSyncing && driveFiles.length === 0) {
                                        return <p className="text-gray-500 text-sm text-center py-2">No files synced from Google Drive yet.</p>;
                                    }
                                    if (driveFiles.length > 0) {
                                        return (
                                            <ul className="space-y-2">
                                                {driveFiles.map(file => (
                                                    <li key={file.id} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md text-sm">
                                                        <div className="flex items-center min-w-0">
                                                            <FileTypeIcon type={file.type} source={file.source} />
                                                            <span className="truncate text-gray-300" title={file.name}>
                                                                {file.name}
                                                            </span>
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
                                    }
                                    return null;
                                })()}
                           </div>
                       </details>
                    )}

                    {/* General Empty State */}
                    {!client.airtable_base_id && !client.google_drive_folder_url && (
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
                                <p className="text-gray-200">{viewingFile.source === 'GOOGLE_DRIVE' ? 'Google Drive' : 'Airtable'}</p>
                            </div>
                        </div>

                        {viewingFile.source_modified_at && (
                             <div>
                                <p className="font-semibold text-gray-400">{viewingFile.source === 'GOOGLE_DRIVE' ? 'Last Modified (Drive)' : 'Last Update (Airtable)'}</p>
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
