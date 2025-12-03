
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive'; 

let gapiClientInitialized = false;
let cachedAccessToken: string | null = null;
let tokenExpiryTime: number = 0;

// Store config in memory for refreshes
let config: { apiKey: string; clientId: string; clientSecret: string; refreshToken: string | null } | null = null;

function waitForGlobal<T>(name: 'gapi' | 'google', timeout = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
        const check = () => {
            if (window[name]) resolve(window[name] as T);
            else if (performance.now() > timeout) reject(new Error(`Timeout loading ${name}`));
            else setTimeout(check, 100);
        };
        check();
    });
}

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
    });
};

/**
 * Exchanges the Authorization Code for Access & Refresh Tokens.
 */
async function exchangeCodeForToken(clientId: string, clientSecret: string, code: string) {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', window.location.origin); 

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Token Exchange Failed: ${err.error_description || err.error}`);
    }

    return await res.json();
}

/**
 * Uses the stored Refresh Token to get a new Access Token.
 */
async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Token Refresh Failed: ${err.error_description || err.error}`);
    }

    return await res.json();
}

const ensureAccessToken = async (): Promise<void> => {
    // 1. Check if we have a valid cached token
    if (cachedAccessToken && Date.now() < tokenExpiryTime) return;

    // 2. If not, try to refresh using the stored Refresh Token
    if (config?.refreshToken && config?.clientSecret) {
        try {
            const tokens = await refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
            cachedAccessToken = tokens.access_token;
            const expiresInMs = (tokens.expires_in || 3599) * 1000;
            tokenExpiryTime = Date.now() + expiresInMs - 30000; // 30s buffer
            return;
        } catch (e) {
            console.error("Auto-refresh failed:", e);
            throw new Error("Session expired. Please reconnect Google Drive in Settings.");
        }
    }

    throw new Error("No access token available. Please connect Google Drive.");
};

export const googleDriveService = {
  /**
   * Initializes the GAPI client for API calls.
   */
  init: async (creds: { apiKey: string; clientId: string; clientSecret?: string; refreshToken?: string }): Promise<void> => {
    config = {
        apiKey: creds.apiKey,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret || '',
        refreshToken: creds.refreshToken || null
    };

    if (!gapiClientInitialized) {
        const gapi = await waitForGlobal<any>('gapi');
        await new Promise<void>((resolve) => gapi.load('client', resolve));
        await gapi.client.init({ apiKey: creds.apiKey, discoveryDocs: [DISCOVERY_DOC] });
        gapiClientInitialized = true;
    }

    // Try to ensure we have a token immediately
    if (config.refreshToken) {
        try {
            await ensureAccessToken();
        } catch (e) {
            console.warn("Could not restore session from refresh token:", e);
        }
    }
  },
  
  /**
   * Triggers the popup to get the initial permissions.
   */
  connect: async (apiKey: string, clientId: string, clientSecret: string): Promise<string> => {
    await googleDriveService.init({ apiKey, clientId, clientSecret });
    const google = await waitForGlobal<any>('google');

    return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initCodeClient({
            client_id: clientId,
            scope: SCOPES,
            ux_mode: 'popup',
            callback: async (response: any) => {
                if (response.code) {
                    try {
                        const tokens = await exchangeCodeForToken(clientId, clientSecret, response.code);
                        cachedAccessToken = tokens.access_token;
                        const expiresInMs = (tokens.expires_in || 3599) * 1000;
                        tokenExpiryTime = Date.now() + expiresInMs - 30000;

                        if (tokens.refresh_token) {
                            config!.refreshToken = tokens.refresh_token;
                            resolve(tokens.refresh_token);
                        } else {
                            console.warn("No refresh token returned.");
                            resolve(''); 
                        }
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error("User cancelled auth or failed to get code."));
                }
            },
        });
        client.requestCode();
    });
  },

  getFolderIdFromUrl: (url: string): string | null => {
      const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
      const urlMatch = url.match(/drive\/[a-z]+\/([a-zA-Z0-9_-]+)/);
      return urlMatch ? urlMatch[1] : null;
  },

  /**
   * Gets the "Start Page Token" for tracking changes.
   * Call this when first syncing a folder to establish a baseline.
   */
  getStartPageToken: async (): Promise<string> => {
      const gapi = window.gapi as any;
      await ensureAccessToken();
      gapi.client.setToken({ access_token: cachedAccessToken });
      
      const res = await gapi.client.drive.changes.getStartPageToken({});
      return res.result.startPageToken;
  },

  /**
   * Gets a list of changes since the last token.
   * Efficiently returns only what has changed (added, modified, deleted).
   */
  getChanges: async (startPageToken: string): Promise<{ changes: any[], newStartPageToken: string }> => {
      const gapi = window.gapi as any;
      await ensureAccessToken();
      gapi.client.setToken({ access_token: cachedAccessToken });

      let allChanges: any[] = [];
      let pageToken = startPageToken;
      
      try {
        // Loop until we have all pages of changes
        while (true) {
            const res: any = await gapi.client.drive.changes.list({
                pageToken: pageToken,
                fields: 'newStartPageToken, nextPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, parents, trashed))',
                pageSize: 1000
            });
            
            const changes = res.result.changes || [];
            allChanges = allChanges.concat(changes);

            if (res.result.nextPageToken) {
                pageToken = res.result.nextPageToken;
            } else {
                return { 
                    changes: allChanges, 
                    newStartPageToken: res.result.newStartPageToken 
                };
            }
        }
      } catch (error: any) {
          // Check for 410 Gone (Token Expired) or 400 (Invalid Token)
          const errorMsg = JSON.stringify(error);
          if (errorMsg.includes('410') || errorMsg.includes('StartPageToken is no longer valid') || errorMsg.includes('400')) {
              throw new Error("INVALID_SYNC_TOKEN");
          }
          throw error;
      }
  },

  /**
   * Traditional full list (fallback or initial init)
   */
  getListOfFiles: async (folderUrl: string): Promise<{ id: string; name: string; mimeType: string; modifiedTime: string }[]> => {
    const gapi = window.gapi as any;
    await ensureAccessToken();

    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) throw new Error("Invalid URL");

    const fetchRecursively = async (parentId: string): Promise<any[]> => {
         let allFiles: any[] = [];
         let pageToken = null;
         
         // PERMISSIVE QUERY: Retrieve ALL files in the folder (trashed=false).
         // We do NOT filter by mimeType here to avoid missing valid files that Google has mislabeled.
         // We filter strictly in the application code instead.
         const q = `'${parentId}' in parents and trashed = false`;

         do {
             gapi.client.setToken({ access_token: cachedAccessToken });
            const res: any = await gapi.client.drive.files.list({
                q: q, fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)', pageSize: 1000, pageToken: pageToken
            });
            const items = res.result.files || [];
            
            // Separate folders for recursion, and exclude Shortcuts to prevent circular loops or errors
            const files = items.filter((i: any) => 
                i.mimeType !== 'application/vnd.google-apps.folder' && 
                i.mimeType !== 'application/vnd.google-apps.shortcut'
            );
            const folders = items.filter((i: any) => i.mimeType === 'application/vnd.google-apps.folder');
            
            allFiles = allFiles.concat(files);
            for (const f of folders) allFiles = allFiles.concat(await fetchRecursively(f.id));
            pageToken = res.result.nextPageToken;
         } while (pageToken);
         return allFiles;
    };

    const allFiles = await fetchRecursively(folderId);
    return Array.from(new Map(allFiles.map((item:any) => [item.id, item])).values()) as any[];
  },

  getFileContent: async (fileId: string, mimeType: string): Promise<string> => {
    const gapi = window.gapi as any;
    await ensureAccessToken();
    gapi.client.setToken({ access_token: cachedAccessToken });
    
    // Google Sheets -> CSV
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('sheet') || mimeType === 'text/csv') {
        // If it's a native Google Sheet
        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
             const res = await gapi.client.drive.files.export({ fileId, mimeType: 'text/csv' });
             return res.body;
        }
        // If it's Excel or CSV uploaded as blob
    }

    if (mimeType.includes('document')) {
        const res = await gapi.client.drive.files.export({ fileId, mimeType: 'text/plain' });
        return res.body;
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${cachedAccessToken}` }
    });
    if (!res.ok) throw new Error("Download failed");
    
    if (mimeType.startsWith('image/')) {
        return blobToBase64(await res.blob());
    }
    return await res.text();
  },

  updateFileContent: async (fileId: string, newContent: string, mimeType: string) => {
      await ensureAccessToken();
      const metadata = { mimeType };
      const boundary = 'foo_bar_baz';
      const body = `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${newContent}\r\n--${boundary}--`;
      
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${cachedAccessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: body
      });
  },
  
  findOrCreateFolder: async (parentId: string, name: string): Promise<string> => {
    const gapi = window.gapi as any;
    await ensureAccessToken();
    gapi.client.setToken({ access_token: cachedAccessToken });

    const listRes = await gapi.client.drive.files.list({ q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`, pageSize: 1 });
    if (listRes.result.files?.length) return listRes.result.files[0].id;
    const createRes = await gapi.client.drive.files.create({ resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }, fields: 'id' });
    return createRes.result.id;
  },

  uploadImageFile: async (parentId: string, name: string, base64: string, mimeType: string) => {
    await ensureAccessToken();
    const boundary = '-------314159265358979323846';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
    
    const bodyParts = [
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}`,
        `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`
    ];
    
    const blob = new Blob([bodyParts[0], bodyParts[1], bytes, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` });
    
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cachedAccessToken}` },
        body: blob
    });
    return await res.json();
  }
};
