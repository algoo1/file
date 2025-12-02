
import { FileObject } from '../types.ts';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive'; 

let tokenClient: any = null;
let gapiClientInitialized = false;
let isInitializing = false;
let initPromise: Promise<void> | null = null;
let cachedAccessToken: string | null = null;
let tokenExpiryTime: number = 0;

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

const handleTokenResponse = (tokenResponse: any) => {
    if (tokenResponse && tokenResponse.access_token) {
        cachedAccessToken = tokenResponse.access_token;
        const expiresInMs = (tokenResponse.expires_in || 3599) * 1000;
        tokenExpiryTime = Date.now() + expiresInMs - 300000; // 5 min buffer
        console.log("Google Drive Token refreshed securely.");
    }
};

const ensureAccessToken = async (): Promise<void> => {
    if (!tokenClient) throw new Error("Google Drive Service not initialized.");
    
    // Check if valid
    if (cachedAccessToken && Date.now() < tokenExpiryTime) return;

    // Try silent refresh
    console.log("Refreshing Google Token silently...");
    return new Promise((resolve, reject) => {
        try {
            // We temporarily override the callback for this specific request
            // This allows us to await the result of the silent refresh
            const originalCallback = tokenClient.callback;
            
            tokenClient.callback = (resp: any) => {
                // Restore original callback
                tokenClient.callback = originalCallback;
                
                if (resp.error) {
                    console.error("Silent refresh failed:", resp);
                    reject(new Error("Session expired. Please reconnect Google Drive in Settings."));
                } else {
                    handleTokenResponse(resp);
                    resolve();
                }
            };
            
            // prompt: '' is critical for silent refresh. 
            // If the user has approved access before, this returns a token without a popup.
            tokenClient.requestAccessToken({ prompt: '' });
        } catch (err) {
            reject(err);
        }
    });
};

export const googleDriveService = {
  init: async (apiKey: string, clientId: string): Promise<void> => {
    if (gapiClientInitialized) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const gapi = await waitForGlobal<any>('gapi');
            const google = await waitForGlobal<any>('google');

            await new Promise<void>((resolve) => gapi.load('client', resolve));
            await gapi.client.init({ apiKey: apiKey, discoveryDocs: [DISCOVERY_DOC] });

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                callback: handleTokenResponse,
            });

            gapiClientInitialized = true;
            
            // Attempt an immediate silent load to restore session on page reload
            try { 
                await ensureAccessToken(); 
            } catch (e) {
                console.log("Initial silent auth check: User needs to connect manually once.");
            }

        } catch (err) {
            console.error("GAPI Init Error:", err);
            throw err;
        } finally {
            isInitializing = false;
        }
    })();
    
    return initPromise;
  },
  
  connect: async (apiKey: string, clientId: string): Promise<void> => {
    await googleDriveService.init(apiKey, clientId);
    return new Promise<void>((resolve, reject) => {
        tokenClient.callback = (resp: any) => {
            if (resp.error) reject(resp);
            else {
                handleTokenResponse(resp);
                resolve();
            }
        };
        // This triggers the popup (consent). Only needed once.
        tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  },

  getFolderIdFromUrl: (url: string): string | null => {
      const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
      const urlMatch = url.match(/drive\/[a-z]+\/([a-zA-Z0-9_-]+)/);
      return urlMatch ? urlMatch[1] : null;
  },

  getListOfFiles: async (folderUrl: string): Promise<{ id: string; name: string; mimeType: string; modifiedTime: string }[]> => {
    const gapi = window.gapi as any;
    await ensureAccessToken();

    const folderId = googleDriveService.getFolderIdFromUrl(folderUrl);
    if (!folderId) throw new Error("Invalid URL");

    const fetchRecursively = async (parentId: string): Promise<any[]> => {
         let allFiles: any[] = [];
         let pageToken = null;
         const q = `'${parentId}' in parents and trashed = false and (mimeType='application/vnd.google-apps.folder' or mimeType='application/pdf' or mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`;

         do {
            const res: any = await gapi.client.drive.files.list({
                q: q, fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)', pageSize: 1000, pageToken: pageToken
            });
            const items = res.result.files || [];
            const files = items.filter((i: any) => i.mimeType !== 'application/vnd.google-apps.folder');
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
    
    if (mimeType.includes('spreadsheet')) {
        const res = await gapi.client.drive.files.export({ fileId, mimeType: 'text/csv' });
        return res.body;
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
