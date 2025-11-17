// A single place for all our data structures

/** Represents a file synced from a data source, as seen by the UI. */
export interface SyncedFile {
  id: string;
  name: string;
  status: 'IDLE' | 'SYNCING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
  statusMessage?: string;
  type: 'pdf' | 'sheet' | 'image' | 'record';
  source: 'GOOGLE_DRIVE' | 'AIRTABLE';
}

/** Represents a full file/record object used by services, including its content. */
export interface FileObject {
    id: string;
    name: string;
    type: 'pdf' | 'sheet' | 'image' | 'record';
    mimeType: string;
    content: string;
    summary: string;
    status: 'IDLE' | 'SYNCING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
    statusMessage?: string;
    source: 'GOOGLE_DRIVE' | 'AIRTABLE';
}

export interface Tag {
  id:string;
  name: string;
}

export interface Client {
  id: string;
  name: string;
  apiKey: string;
  syncedFiles: SyncedFile[];
  tags: Tag[];
  syncInterval: number | 'MANUAL'; // in milliseconds, or 'MANUAL' for on-demand
  
  // Google Drive Data Source
  googleDriveFolderUrl: string | null;

  // Airtable Data Source - supports two methods
  // 1. Personal Access Token (PAT)
  airtableApiKey: string | null;
  airtableBaseId: string | null;
  airtableTableId: string | null;

  // 2. OAuth 2.0
  airtableAccessToken: string | null;
  airtableRefreshToken: string | null;
  airtableTokenExpiresAt: number | null; // Store as timestamp (Date.now() + expiresIn * 1000)
}

export interface SystemSettings {
  fileSearchServiceApiKey: string;
  googleApiKey: string;
  googleClientId: string;
  googleClientSecret: string;
  isGoogleDriveConnected: boolean;
  
  // Airtable OAuth App Credentials
  airtableClientId: string;
  isAirtableConnected: boolean; // True if OAuth app creds are saved
}
