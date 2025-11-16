// A single place for all our data structures

/** Represents a file synced from Google Drive, as seen by the UI. */
export interface SyncedFile {
  id: string;
  name: string;
  status: 'IDLE' | 'SYNCING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
}

/** Represents a full file object used by services, including its content. */
export interface FileObject {
    id: string;
    name: string;
    type: 'pdf' | 'sheet';
    content: string;
    summary: string; 
    status: 'IDLE' | 'SYNCING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
}

export interface Tag {
  id:string;
  name: string;
}

export interface Client {
  id: string;
  name: string;
  apiKey: string;
  googleDriveFolderUrl: string | null;
  syncedFiles: SyncedFile[];
  tags: Tag[];
}

export interface SystemSettings {
  fileSearchServiceApiKey: string;
  googleApiKey: string;
  googleClientId: string;
  googleClientSecret: string;
  isGoogleDriveConnected: boolean;
}
