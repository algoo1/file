
import { FileObject } from '../types.ts';

// See: https://developers.google.com/drive/api/guides/api-specific-auth
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let tokenClient: any = null;

export const googleDriveService = {
  /**
   * Initializes the GAPI client and GSI token client.
   * This is called when the user clicks "Connect".
   */
  connect: async (apiKey: string, clientId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        // Poll for gapi and gsi to be loaded by the scripts in index.html
        const checkGapiAndGsi = () => {
            if (window.gapi && window.google) {
                // Load the client library
                window.gapi.load('client', () => {
                    // Initialize the GAPI client
                    window.gapi.client.init({
                        apiKey: apiKey,
                        discoveryDocs: [DISCOVERY_DOC],
                    }).then(() => {
                        // Initialize the GSI token client
                        tokenClient = window.google.accounts.oauth2.initTokenClient({
                            client_id: clientId,
                            scope: SCOPES,
                            callback: (tokenResponse: any) => {
                                if (tokenResponse && tokenResponse.access_token) {
                                    console.log("Successfully connected and authenticated with Google Drive.");
                                    resolve();
                                } else {
                                    // This can happen if the user closes the popup
                                    reject(new Error("Failed to acquire access token. The user may have cancelled the action."));
                                }
                            },
                        });
                        // Prompt user to sign in immediately after initialization
                        googleDriveService.signIn();
                    }).catch((err: any) => {
                        console.error("Error initializing GAPI client", err);
                        reject(new Error("Error initializing GAPI client. Check your API Key."));
                    });
                });
            } else {
                setTimeout(checkGapiAndGsi, 100); // Wait and retry
            }
        };
        checkGapiAndGsi();
    });
  },

  /**
   * Prompts the user to sign in and grant access.
   */
  signIn: () => {
    if (!tokenClient) {
        throw new Error("GSI token client not initialized. Call connect() first.");
    }
    // Prompt user to select an account and grant access.
    tokenClient.requestAccessToken({prompt: 'consent'});
  },

  /**
   * Extracts folder ID from a Google Drive URL.
   */
  getFolderIdFromUrl: (url: string): string | null => {
      const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
  },

  /**
   * Fetches a list of files and their content from a Google Drive folder.
   */
  getFilesFromFolder: async (folderUrl: string): Promise<Omit<FileObject, 'summary' | 'status'>[]> => {
    if (!window.gapi?.client?.drive) {
        throw new Error("GAPI client not initialized or not connected. Please connect to Google Drive first.");
    }
    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) {
        throw new Error("Invalid Google Drive folder URL. Please use a valid URL like 'https://drive.google.com/drive/folders/...'");
    }

    console.log(`Fetching files from Google Drive folder ID: ${folderId}`);
    
    const response = await window.gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='application/vnd.google-apps.spreadsheet')`,
      fields: 'files(id, name, mimeType)',
    });

    const files = response.result.files;
    if (!files || files.length === 0) {
      return [];
    }

    const fileContentPromises = files.map(async (file: any) => {
      console.log(`Fetching content for: ${file.name}`);
      let content = '';
      let fileType: 'pdf' | 'sheet' = 'pdf';

      try {
        if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
          const exportResponse = await window.gapi.client.drive.files.export({ fileId: file.id, mimeType: 'text/csv' });
          content = exportResponse.body;
          fileType = 'sheet';
        } else if (file.mimeType === 'application/vnd.google-apps.document') {
          const exportResponse = await window.gapi.client.drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
          content = exportResponse.body;
          fileType = 'pdf'; // Treat as a text-based doc
        } else {
          // For PDF and plain text, get content directly
          const fileResponse = await window.gapi.client.drive.files.get({ fileId: file.id, alt: 'media' });
          content = fileResponse.body; // Note: For PDFs, this will be garbled text without a proper parser.
          fileType = file.mimeType === 'application/pdf' ? 'pdf' : 'sheet'; // simplistic mapping
        }

        return {
          id: file.id,
          name: file.name,
          type: fileType,
          content: content.substring(0, 200000), // Truncate content to avoid being too large
        };
      } catch (err: any) {
        console.error(`Failed to fetch content for ${file.name}:`, err);
        if (err.status === 403) {
            alert(`Permission denied for file: ${file.name}. Ensure the file is shared with the account you connected.`);
        }
        return null;
      }
    });

    const settledFiles = await Promise.all(fileContentPromises);
    return settledFiles.filter(f => f !== null) as Omit<FileObject, 'summary' | 'status'>[];
  },
};
