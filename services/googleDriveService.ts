
import { FileObject } from '../types.ts';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let tokenClient: any = null;

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


export const googleDriveService = {
  /**
   * Initializes the GAPI client and authenticates the user with Google using a robust sequential flow.
   */
  connect: async (apiKey: string, clientId: string): Promise<void> => {
    try {
      const gapi = await waitForGlobal<any>('gapi');
      const google = await waitForGlobal<any>('google');

      // Step 1: Load the GAPI client library.
      await new Promise<void>((resolve, reject) => {
        gapi.load('client', {
          callback: resolve,
          onerror: reject,
          timeout: 5000,
          ontimeout: () => reject(new Error('GAPI client load timed out.'))
        });
      });

      // Step 2: Initialize the GAPI client. This does not perform user authentication.
      await gapi.client.init({
        apiKey: apiKey,
        discoveryDocs: [DISCOVERY_DOC],
      });
      console.log("GAPI client initialized successfully.");

      // Step 3: Use GSI for authentication (token flow) and get the token.
      const tokenResponse = await new Promise<any>((resolve, reject) => {
        try {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                callback: (response: any) => {
                    if (response.error) {
                        return reject(response);
                    }
                    if (!response.access_token) {
                         return reject(new Error("Authentication failed: No access token was received from Google. The user may have cancelled the sign-in."));
                    }
                    console.log("Successfully authenticated and received access token.");
                    resolve(response);
                },
                error_callback: (error: any) => {
                    const friendlyMessage = `Authentication failed.\n\n` +
                      `Error from Google: "${error.type || 'Unknown error'}"\n\n` +
                      `Please check your Google Cloud project setup:\n` +
                      `1. Is the OAuth Client ID correct?\n` +
                      `2. Have you added your current URL (${window.location.origin}) to the 'Authorized JavaScript origins' for that Client ID?`;
                    reject(new Error(friendlyMessage));
                },
            });
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch(err) {
            reject(err);
        }
      });
      
      // Step 4: Set the access token for the GAPI client.
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
   * Prompts the user to sign in and grant access. Can be used for re-authentication.
   */
  signIn: () => {
    if (!tokenClient) {
        console.warn("GSI token client not initialized. Calling connect() is recommended.");
        alert("Connection not initialized. Please go through the setup process first.");
        return;
    }
    // 'consent' ensures the user sees the permissions screen again, useful for re-linking
    tokenClient.requestAccessToken({prompt: 'consent'});
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
  getListOfFiles: async (folderUrl: string): Promise<{ id: string; name: string; mimeType: string }[]> => {
    const gapi = window.gapi as any;
    if (!gapi?.client?.drive) {
        throw new Error("GAPI client not initialized. Please connect to Google Drive.");
    }
    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) {
        throw new Error("Invalid Google Drive folder URL. Please use a valid URL like 'https://drive.google.com/drive/folders/...'");
    }

    console.log(`Fetching file list from Google Drive folder ID: ${folderId}`);
    
    const response = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='application/vnd.google-apps.spreadsheet')`,
      fields: 'files(id, name, mimeType)',
      pageSize: 500 // Fetch up to 500 files
    });

    const files = response.result.files;
    return files || [];
  },

  /**
   * Fetches the content for a single file from Google Drive.
   * @param fileId The ID of the file.
   * @param mimeType The MIME type of the file.
   * @returns A promise that resolves to the string content of the file.
   */
  getFileContent: async (fileId: string, mimeType: string): Promise<string> => {
    const gapi = window.gapi as any;
    try {
        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
            const exportResponse = await gapi.client.drive.files.export({ fileId: fileId, mimeType: 'text/csv' });
            return exportResponse.body;
        }
        
        if (mimeType === 'application/vnd.google-apps.document') {
            const exportResponse = await gapi.client.drive.files.export({ fileId: fileId, mimeType: 'text/plain' });
            return exportResponse.body;
        }

        // Handles PDF and plain text
        const fileResponse = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
        return fileResponse.body;

    } catch (err: any) {
        console.error(`Failed to fetch content for file ID ${fileId}:`, err);
        if (err.status === 403) {
            throw new Error(`Permission denied for file. Ensure the connected account has at least 'Viewer' access.`);
        }
        throw new Error(`Failed to download file content. Error: ${err.result?.error?.message || err.message}`);
    }
  },
};
