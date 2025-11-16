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
   * Initializes the GAPI client and authenticates the user with Google.
   */
  connect: async (apiKey: string, clientId: string): Promise<void> => {
    try {
      // 1. Wait for both scripts to load and populate their globals
      const gapi = await waitForGlobal<any>('gapi');
      const google = await waitForGlobal<any>('google');

      // 2. Load the GAPI client library and initialize it for Drive API calls
      await new Promise<void>((resolve, reject) => {
          gapi.load('client', async () => {
              try {
                  await gapi.client.init({
                      apiKey: apiKey,
                      discoveryDocs: [DISCOVERY_DOC],
                  });
                  console.log("GAPI client initialized successfully.");
                  resolve();
              } catch (err: any) {
                  console.error("Error details during GAPI client initialization:", err);
                  let details = err.details || (err.result?.error?.message) || err.message || "An unknown error occurred.";
                  
                  const friendlyMessage = `Failed to initialize Google Drive client.\n\n` +
                    `Error from Google: "${details}"\n\n` +
                    `Please check your Google Cloud project setup:\n` +
                    `1. Is the Google Drive API enabled?\n` +
                    `2. Is the API Key correct and unrestricted, or does it allow your current URL (${window.location.origin}) as an HTTP referrer?`;
                    
                  reject(new Error(friendlyMessage));
              }
          });
      });

      // 3. Initialize the GSI token client and get user consent + access token
      return new Promise<void>((resolve, reject) => {
          try {
              tokenClient = google.accounts.oauth2.initTokenClient({
                  client_id: clientId,
                  scope: SCOPES,
                  callback: (tokenResponse: any) => {
                      if (tokenResponse && tokenResponse.access_token) {
                          console.log("Successfully authenticated and received access token.");
                          // Set the token for GAPI client to use
                          gapi.client.setToken({ access_token: tokenResponse.access_token });
                          resolve();
                      } else {
                          reject(new Error("Authentication failed: No access token was received from Google. The user may have cancelled the sign-in."));
                      }
                  },
                   error_callback: (error: any) => {
                      console.error("GSI Authentication Error Callback:", error);
                       const friendlyMessage = `Authentication failed.\n\n` +
                        `Error from Google: "${error.type || 'Unknown error'}"\n\n` +
                        `Please check your Google Cloud project setup:\n` +
                        `1. Is the OAuth Client ID correct?\n` +
                        `2. Have you added your current URL (${window.location.origin}) to the 'Authorized JavaScript origins' for that Client ID?`;

                      reject(new Error(friendlyMessage));
                  },
              });
              // Prompt user to sign in
              tokenClient.requestAccessToken({ prompt: 'consent' });
          } catch (err: any) {
              console.error("Error initializing GSI token client:", err);
              reject(err);
          }
      });
    } catch (error) {
        console.error("Google Drive connection process failed:", error);
        throw error; // Re-throw the formatted error from the failed step
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
   * Fetches a list of files and their content from a Google Drive folder.
   */
  getFilesFromFolder: async (folderUrl: string): Promise<Omit<FileObject, 'summary' | 'status'>[]> => {
    const gapi = window.gapi as any; // Assume gapi is available after connect() succeeds
    if (!gapi?.client?.drive) {
        throw new Error("GAPI client not initialized or not connected. Please connect to Google Drive first.");
    }
    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) {
        throw new Error("Invalid Google Drive folder URL. Please use a valid URL like 'https://drive.google.com/drive/folders/...'");
    }

    console.log(`Fetching files from Google Drive folder ID: ${folderId}`);
    
    const response = await gapi.client.drive.files.list({
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
          const exportResponse = await gapi.client.drive.files.export({ fileId: file.id, mimeType: 'text/csv' });
          content = exportResponse.body;
          fileType = 'sheet';
        } else if (file.mimeType === 'application/vnd.google-apps.document') {
          const exportResponse = await gapi.client.drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
          content = exportResponse.body;
          fileType = 'pdf'; 
        } else { // Handles PDF and plain text
          const fileResponse = await gapi.client.drive.files.get({ fileId: file.id, alt: 'media' });
          content = fileResponse.body; 
          fileType = 'pdf'; // Simplified type for non-sheets
        }

        return {
          id: file.id,
          name: file.name,
          type: fileType,
          content: content.substring(0, 200000), 
        };
      } catch (err: any) {
        console.error(`Failed to fetch content for ${file.name}:`, err);
        if (err.status === 403) {
            alert(`Permission denied for file: ${file.name}. Ensure the account you connected has at least 'Viewer' access to this file.`);
        }
        return null;
      }
    });

    const settledFiles = await Promise.all(fileContentPromises);
    return settledFiles.filter(f => f !== null) as Omit<FileObject, 'summary' | 'status'>[];
  },
};