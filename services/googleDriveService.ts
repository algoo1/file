
import { FileObject } from '../types.ts';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
// Added drive.readonly and drive.metadata.readonly to ensure we can list files in folders provided by URL
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly'; 

let tokenClient: any = null;
let gapiClientInitialized = false;
let isInitializing = false;

// Store credentials for lazy/retry initialization
let storedApiKey: string | null = null;
let storedClientId: string | null = null;

// Token Management State
let cachedAccessToken: string | null = null;
let tokenExpiryTime: number = 0; // Timestamp in ms

/**
 * Helper to wait for global objects from Google's scripts to be ready.
 * @param name The name of the global object (e.g., 'gapi', 'google').
 * @param timeout Milliseconds to wait before failing.
 * @returns A promise that resolves with the global object.
 */
function waitForGlobal<T>(name: 'gapi' | 'google', timeout = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
            if (window[name]) {
                resolve(window[name] as T);
            } else if (Date.now() - startTime > timeout) {
                reject(new Error(`Failed to load Google script for '${name}' within ${timeout}ms. Check your internet connection and ad-blockers.`));
            } else {
                setTimeout(check, 200);
            }
        };
        check();
    });
}

/**
 * Reads a Blob and converts it to a base64 encoded string.
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

/**
 * Stores the token and its expiration time.
 */
const handleTokenResponse = (tokenResponse: any) => {
    if (tokenResponse && tokenResponse.access_token) {
        cachedAccessToken = tokenResponse.access_token;
        // Calculate expiry time. expires_in is in seconds. 
        // We subtract 5 minutes (300000ms) to create a safety buffer for silent refresh.
        const expiresInMs = (tokenResponse.expires_in || 3599) * 1000;
        tokenExpiryTime = Date.now() + expiresInMs - 300000; 
        
        // Also set it in gapi for client library usage
        const gapi = window.gapi as any;
        if (gapi && gapi.client) {
            gapi.client.setToken(tokenResponse);
        }
        console.log(`Google Access Token refreshed. Valid for ~${Math.round((expiresInMs - 300000)/60000)} minutes.`);
    }
};

/**
 * Internal helper to ensure we have a valid access token.
 * intelligently handles silent refreshes to avoid popups.
 */
const ensureAccessToken = async (): Promise<void> => {
    // Lazy Initialization Check
    if (!gapiClientInitialized) {
        if (storedApiKey && storedClientId) {
            console.log("GAPI not initialized, attempting lazy initialization...");
            await googleDriveService.init(storedApiKey, storedClientId);
        } else {
             throw new Error("Google Drive Service not initialized. Please refresh or reconnect.");
        }
    }

    if (!tokenClient) {
         throw new Error("Google Token Client not ready. Please refresh.");
    }

    // 1. Check if the cached token is still valid
    if (cachedAccessToken && Date.now() < tokenExpiryTime) {
        // Token is valid, check if GAPI has it set
        const gapi = window.gapi as any;
        if (gapi.client.getToken()) {
            return; // All good, proceed without network call
        }
    }

    console.log("Google access token expired or missing. Attempting silent refresh...");

    return new Promise((resolve, reject) => {
        try {
            // Override callback for this specific request
            tokenClient.callback = (resp: any) => {
                if (resp.error) {
                    console.warn("Silent refresh failed:", resp);
                    // If silent refresh fails (e.g. session expired), we might need to prompt.
                    reject(new Error(`Silent auth refresh failed: ${JSON.stringify(resp)}`));
                } else {
                    handleTokenResponse(resp);
                    resolve();
                }
            };
            
            // Request token silently (prompt: ''). 
            // This works if the user has an active Google session in the browser.
            tokenClient.requestAccessToken({ prompt: '' });
        } catch (err) {
            reject(err);
        }
    });
};


export const googleDriveService = {
  /**
   * Silently initializes the GAPI client library without user interaction.
   * Idempotent: Can be called multiple times safely.
   */
  init: async (apiKey: string, clientId: string): Promise<void> => {
    // Store credentials for lazy retry
    storedApiKey = apiKey;
    storedClientId = clientId;

    if (gapiClientInitialized) {
        return;
    }

    // Prevent concurrent initializations
    if (isInitializing) {
        console.log("GAPI initialization already in progress, waiting...");
        return new Promise((resolve, reject) => {
            const checkInit = () => {
                if (gapiClientInitialized) resolve();
                else if (!isInitializing) reject(new Error("Concurrent initialization failed."));
                else setTimeout(checkInit, 100);
            };
            checkInit();
        });
    }

    isInitializing = true;

    try {
        console.log("Starting GAPI initialization...");
        const gapi = await waitForGlobal<any>('gapi');
        const google = await waitForGlobal<any>('google');

        await new Promise<void>((resolve, reject) => {
            gapi.load('client', {
                callback: resolve,
                onerror: reject,
                timeout: 10000, // 10s timeout for load
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
            callback: (resp: any) => handleTokenResponse(resp),
        });

        gapiClientInitialized = true;
        console.log("GAPI client initialized successfully.");
        
        // Attempt an immediate silent connection check to preload token
        try {
            tokenClient.requestAccessToken({ prompt: '' });
        } catch (e) {
            // Ignore initial silent fail
        }

    } catch (err) {
        gapiClientInitialized = false;
        console.error("Failed to initialize GAPI client:", err);
        throw err;
    } finally {
        isInitializing = false;
    }
  },
  
  /**
   * Initializes the GAPI client and authenticates the user with Google.
   * Used for the initial explicit "Connect" button click.
   */
  connect: async (apiKey: string, clientId: string): Promise<void> => {
    try {
      await googleDriveService.init(apiKey, clientId);
      
      const gapi = window.gapi as any;

      await new Promise<any>((resolve, reject) => {
        try {
            if (!tokenClient) throw new Error("GSI token client not initialized.");
            
            tokenClient.callback = (response: any) => {
                if (response.error) {
                    return reject(response);
                }
                if (!response.access_token) {
                     return reject(new Error("Authentication failed: No access token received."));
                }
                handleTokenResponse(response);
                resolve(response);
            };

            tokenClient.error_callback = (error: any) => {
                reject(new Error(`Google Auth Error: ${error.type}`));
            };

            // Force consent only on explicit connect to ensure permissions are granted
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch(err) {
            reject(err);
        }
      });
      
    } catch (err: any) {
        console.error("Google Drive connection process failed:", err);
        const errorMsg = err.details || (err.result?.error?.message) || JSON.stringify(err);
        throw new Error(`Failed to connect: ${errorMsg}`);
    }
  },

  getFolderIdFromUrl: (url: string): string | null => {
      const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
      const urlMatch = url.match(/drive\/[a-z]+\/([a-zA-Z0-9_-]+)/);
      return urlMatch ? urlMatch[1] : null;
  },

  getListOfFiles: async (folderUrl: string): Promise<{ id: string; name: string; mimeType: string; modifiedTime: string }[]> => {
    const gapi = window.gapi as any;
    
    // Check token before call (will trigger lazy init if needed)
    await ensureAccessToken();

    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) {
        throw new Error("Invalid Google Drive folder URL.");
    }
    
    try {
        const response = await gapi.client.drive.files.list({
          q: `'${folderId}' in parents and trashed = false and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`,
          fields: 'files(id, name, mimeType, modifiedTime)',
          pageSize: 500
        });
        return response.result.files || [];
    } catch (error: any) {
        const msg = error.result?.error?.message || error.message || JSON.stringify(error);
        throw new Error(`Failed to list files: ${msg}`);
    }
  },

  getFileContent: async (fileId: string, mimeType: string): Promise<string> => {
    const gapi = window.gapi as any;
    await ensureAccessToken();
    const token = gapi?.client?.getToken();
    
    try {
        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
            const exportResponse = await gapi.client.drive.files.export({ fileId: fileId, mimeType: 'text/csv' });
            return exportResponse.body;
        }
        
        if (mimeType === 'application/vnd.google-apps.document') {
            const exportResponse = await gapi.client.drive.files.export({ fileId: fileId, mimeType: 'text/plain' });
            return exportResponse.body;
        }

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token.access_token}` }
        });

        if (!response.ok) {
             const errorData = await response.json();
             throw new Error(`Google API error: ${errorData.error.message}`);
        }

        if (mimeType.startsWith('image/')) {
            const blob = await response.blob();
            return blobToBase64(blob);
        }
        return await response.text();

    } catch (err: any) {
        const msg = err.result?.error?.message || err.message || JSON.stringify(err);
        console.error(`Failed to fetch content for file ID ${fileId}:`, err);
        throw new Error(`Failed to download file content: ${msg}`);
    }
  },

  /**
   * Updates file content using multipart upload.
   * NOTE: This allows modifying files (e.g. changing prices), but does NOT delete files from Drive.
   */
  updateFileContent: async (fileId: string, newContent: string, mimeType: string): Promise<void> => {
      const gapi = window.gapi as any;
      await ensureAccessToken();
      const token = gapi?.client?.getToken();

      const metadata = { mimeType: mimeType };
      const boundary = 'foo_bar_baz';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";

      const multipartRequestBody =
          delimiter +
          'Content-Type: application/json\r\n\r\n' +
          JSON.stringify(metadata) +
          delimiter +
          `Content-Type: ${mimeType}\r\n\r\n` +
          newContent +
          close_delim;

      try {
        const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token.access_token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body: multipartRequestBody
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Failed to update file');
        }
        console.log(`File ${fileId} updated successfully.`);
      } catch (error) {
          console.error("Update failed:", error);
          throw error;
      }
  }
};
