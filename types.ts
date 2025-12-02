
// A single place for all our data structures, aligned with the Supabase schema.

/** Represents a file synced from a data source, as stored in the database. */
export interface SyncedFile {
  id: string; // uuid
  client_id: string;
  source_item_id: string;
  name: string;
  status: 'IDLE' | 'SYNCING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
  status_message?: string;
  type: 'pdf' | 'sheet' | 'image';
  source: 'GOOGLE_DRIVE';
  summary?: string;
  content?: string; // Stored full content (Text or Base64 for images)
  last_synced_at?: string; // ISO 8601 timestamp
  source_modified_at?: string; // ISO 8601 timestamp from the source
  created_at: string;
  updated_at: string;
}

/** Represents a full file/record object used by services during processing. */
export interface FileObject {
    id: string; // source_item_id
    name: string;
    type: 'pdf' | 'sheet' | 'image';
    mimeType: string;
    content: string;
    summary: string;
    status: 'IDLE' | 'SYNCING' | 'INDEXING' | 'COMPLETED' | 'FAILED';
    statusMessage?: string;
    source: 'GOOGLE_DRIVE';
    source_modified_at?: string;
}

export interface Tag {
  id: string; // uuid
  client_id: string;
  name: string;
  created_at: string;
}

export interface Client {
  id: string; // uuid
  name: string;
  api_key: string;
  google_drive_folder_url: string | null;

  created_at: string;
  updated_at: string;
  // These are relational fields, hydrated by the application
  synced_files: SyncedFile[];
  tags: Tag[];
}

export interface SystemSettings {
  id: number;
  file_search_service_api_key: string;
  google_api_key: string | null;
  google_client_id: string | null;
  google_client_secret: string | null; // NEW: For offline access
  google_refresh_token: string | null; // NEW: Stored persistently
  is_google_drive_connected: boolean;

  created_at: string;
  updated_at: string;
}
