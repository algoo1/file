import { FileObject } from '../types.ts';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let tokenClient: any = null;
let gapiClientInitialized = false;

/**
 * Helper to wait for global objects from Google's scripts to be ready.
 * @param name The name of the global object (e.g., 'gapi', 'google').
 * @param timeout Milliseconds to wait before failing.
 * @returns A promise that resolves with the global object.
 */
function waitForGlobal<T>(name: 'gapi' | 'google', timeout = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
            if (window[name]) {
                resolve(window[name] as T);
            } else if (Date.now() - startTime > timeout) {
                reject(new Error(`Failed to load Google script for '${name}' within ${timeout}ms. Check your internet connection and ad-blockers.`));
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

/**
 * Reads a Blob and converts it to a base64 encoded string.
 * @param blob The blob to convert.
 * @returns A promise that resolves with the base64 string (without the data: prefix).
 */
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // remove the "data:*/*;base64," prefix
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};


export const googleDriveService = {
  /**
   * Silently initializes the GAPI client library without user interaction.
   * This is crucial for re-initializing the client after a page reload.
   */
  init: async (apiKey: string, clientId: string): Promise<void> => {
    if (gapiClientInitialized) {
        return;
    }
    try {
        const gapi = await waitForGlobal<any>('gapi');
        const google = await waitForGlobal<any>('google');

        await new Promise<void>((resolve, reject) => {
            gapi.load('client', {
                callback: resolve,
                onerror: reject,
                timeout: 5000,
                ontimeout: () => reject(new Error('GAPI client library load timed out.'))
            });
        });

        await gapi.client.init({
            apiKey: apiKey,
            discoveryDocs: [DISCOVERY_DOC],
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: () => {}, // Callback is handled by the interactive connect() method
        });

        gapiClientInitialized = true;
        console.log("GAPI client silently initialized.");
    } catch (err) {
        gapiClientInitialized = false;
        console.error("Failed to silently initialize GAPI client:", err);
        throw err;
    }
  },
  
  /**
   * Initializes the GAPI client and authenticates the user with Google using a robust sequential flow.
   */
  connect: async (apiKey: string, clientId: string): Promise<void> => {
    try {
      // Ensure the client is initialized first
      await googleDriveService.init(apiKey, clientId);
      
      const gapi = window.gapi as any;

      // Use GSI for authentication (token flow) and get the token.
      const tokenResponse = await new Promise<any>((resolve, reject) => {
        try {
            if (!tokenClient) throw new Error("GSI token client not initialized.");
            
            tokenClient.callback = (response: any) => {
                if (response.error) {
                    return reject(response);
                }
                if (!response.access_token) {
                     return reject(new Error("Authentication failed: No access token was received from Google. The user may have cancelled the sign-in."));
                }
                console.log("Successfully authenticated and received access token.");
                resolve(response);
            };

            tokenClient.error_callback = (error: any) => {
                const friendlyMessage = `Authentication failed.\n\n` +
                  `Error from Google: "${error.type || 'Unknown error'}"\n\n` +
                  `Please check your Google Cloud project setup:\n` +
                  `1. Is the OAuth Client ID correct?\n` +
                  `2. Have you added your current URL (${window.location.origin}) to the 'Authorized JavaScript origins' for that Client ID?`;
                reject(new Error(friendlyMessage));
            };

            tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch(err) {
            reject(err);
        }
      });
      
      // Set the access token for the GAPI client.
      gapi.client.setToken({ access_token: tokenResponse.access_token });
      
    } catch (err: any) {
        console.error("Google Drive connection process failed:", err);
        // Consolidate error messages for better debugging.
        if (err.details || err.result?.error?.message) {
             let details = err.details || (err.result?.error?.message) || "An unknown error occurred.";
             const friendlyMessage = `Failed to initialize Google Drive client.\n\n` +
                `Error from Google: "${details}"\n\n` +
                `Please check your Google Cloud project setup:\n` +
                `1. Is the Google Drive API enabled?\n` +
                `2. Is the API Key correct and unrestricted, or does it allow your current URL (${window.location.origin}) as an HTTP referrer?`;
            throw new Error(friendlyMessage);
        }
        throw err;
    }
  },

  /**
   * Extracts folder ID from a Google Drive URL.
   */
  getFolderIdFromUrl: (url: string): string | null => {
      const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return match[1];
      }
      // Also support URLs without /folders/ in the path, like when viewing the folder content
      const urlMatch = url.match(/drive\/[a-z]+\/([a-zA-Z0-9_-]+)/);
      return urlMatch ? urlMatch[1] : null;
  },

  /**
   * Fetches a list of file metadata from a Google Drive folder.
   * @param folderUrl The URL of the Google Drive folder.
   * @returns A promise that resolves to an array of file metadata objects.
   */
  getListOfFiles: async (folderUrl: string): Promise<{ id: string; name: string; mimeType: string; modifiedTime: string }[]> => {
    const gapi = window.gapi as any;
    if (!gapiClientInitialized || !gapi?.client?.drive) {
        throw new Error("GAPI client not initialized. Please connect to Google Drive.");
    }
     if (!gapi.client.getToken()) {
        throw new Error("Google session expired or user is not signed in. Please reconnect to Google Drive.");
    }

    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) {
        throw new Error("Invalid Google Drive folder URL. Please use a valid URL like 'https://drive.google.com/drive/folders/...'");
    }

    console.log(`Fetching file list from Google Drive folder ID: ${folderId}`);
    
    const response = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`,
      fields: 'files(id, name, mimeType, modifiedTime)',
      pageSize: 500 // Fetch up to 500 files
    });

    const files = response.result.files;
    return files || [];
  },

  /**
   * Fetches the content for a single file from Google Drive.
   * For images, returns a base64 string. For others, returns plain text.
   * @param fileId The ID of the file.
   * @param mimeType The MIME type of the file.
   * @returns A promise that resolves to the string content of the file.
   */
  getFileContent: async (fileId: string, mimeType: string): Promise<string> => {
    const gapi = window.gapi as any;
    const token = gapi?.client?.getToken();
    if (!token?.access_token) {
        throw new Error("User not authenticated or token has expired. Please reconnect to Google Drive.");
    }
    
    try {
        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
            const exportResponse = await gapi.client.drive.files.export({ fileId: fileId, mimeType: 'text/csv' });
            return exportResponse.body;
        }
        
        if (mimeType === 'application/vnd.google-apps.document') {
            const exportResponse = await gapi.client.drive.files.export({ fileId: fileId, mimeType: 'text/plain' });
            return exportResponse.body;
        }

        // For binary files (PDFs, images), use fetch for better handling
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token.access_token}` }
        });

        if (!response.ok) {
             const errorData = await response.json();
             throw new Error(`Google API error: ${errorData.error.message} (Code: ${response.status})`);
        }

        if (mimeType.startsWith('image/')) {
            const blob = await response.blob();
            return blobToBase64(blob);
        }

        // For PDFs and other potential text-based files downloaded directly
        return await response.text();

    } catch (err: any) {
        console.error(`Failed to fetch content for file ID ${fileId}:`, err);
        if (err.message.includes("Code: 403")) {
            throw new Error(`Permission denied for file. Ensure the connected account has at least 'Viewer' access.`);
        }
        throw new Error(`Failed to download file content. Error: ${err.result?.error?.message || err.message}`);
    }
  },
};