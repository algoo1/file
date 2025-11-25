
// This service handles all interactions with the Airtable API.
import { Client, SystemSettings } from '../types.ts';

const AIRTABLE_AUTH_URL = 'https://airtable.com/oauth2/v1/authorize';
// Use a CORS proxy to bypass browser security restrictions for token exchange.
const CORS_PROXY_URL = 'https://corsproxy.io/?';
const AIRTABLE_TOKEN_URL = 'https://airtable.com/oauth2/v1/token';
const REDIRECT_URI = window.location.origin + window.location.pathname;


/**
 * A robust fetch wrapper that provides better error messages and prevents caching.
 * @param url The URL to fetch.
 * @param options The fetch options.
 * @returns A promise that resolves to the Response object.
 */
async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
    try {
        // Ensure we never use cached data for API calls to detect deletions correctly
        const newOptions = {
            ...options,
            headers: {
                ...options.headers,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        };
        return await fetch(url, newOptions);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            throw new Error(
                'Network request failed. This may be due to a browser extension (like an ad-blocker) or a network firewall. Please check your connection and extensions, then try again.'
            );
        }
        throw error; // Re-throw other errors
    }
}


const findPrimaryFieldName = (record: any): string => {
    const commonNames = ['Name', 'Title', 'ID', 'Primary', 'Key', 'Task', 'Item'];
    if (record && record.fields) {
        for (const name of commonNames) {
            if (record.fields[name]) return String(record.fields[name]);
        }
        // If no common name, try the first string field
        for(const key in record.fields) {
            if(typeof record.fields[key] === 'string' && record.fields[key]) return record.fields[key];
        }
    }
    return record.id;
};

const findModifiedTime = (record: any): string => {
    // Airtable doesn't provide a system-level 'modifiedTime' in the record metadata by default.
    // We look for common user-created field names that might track modification.
    const candidates = ['Last Modified', 'Last Modified Time', 'Last Changed', 'Updated', 'Updated At', 'Modification Date'];
    if (record && record.fields) {
        for (const field of candidates) {
            if (record.fields[field]) return String(record.fields[field]);
        }
    }
    // Fallback to createdTime if no specific modification field is found.
    // Note: This means standard records won't auto-update without a Last Modified field in the table.
    return record.createdTime;
};

// PKCE Helper Functions
const base64urlencode = (a: ArrayBuffer): string => {
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(a))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const generateCodeVerifier = (): string => {
    // RFC 7636: 43-128 chars. 
    // 96 bytes of entropy -> base64url encoded -> ~128 chars.
    const array = new Uint8Array(96);
    window.crypto.getRandomValues(array);
    return base64urlencode(array.buffer);
};

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
};

const generateCodeChallenge = async (v: string): Promise<string> => {
    const hashed = await sha256(v);
    return base64urlencode(hashed);
};


export const airtableService = {
  /**
   * Initiates the Airtable OAuth 2.0 PKCE flow.
   * @param clientId The Airtable OAuth App's Client ID.
   * @param clientState The app's internal client ID to pass through the flow.
   */
  initiateOAuth: async (clientId: string, clientState: string): Promise<void> => {
    const codeVerifier = generateCodeVerifier();
    sessionStorage.setItem('airtable_code_verifier', codeVerifier);
    
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
        client_id: clientId.trim(),
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'data.records:read schema.bases:read', 
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: clientState,
    });
    
    window.location.href = `${AIRTABLE_AUTH_URL}?${params.toString()}`;
  },

  /**
   * Handles the OAuth callback from Airtable to exchange the code for an access token.
   * @param code The authorization code from the URL.
   * @param clientId The Airtable OAuth App's Client ID.
   * @returns A promise resolving to the token data.
   */
  handleOAuthCallback: async (code: string, clientId: string): Promise<Partial<Client>> => {
      const codeVerifier = sessionStorage.getItem('airtable_code_verifier');
      if (!codeVerifier) {
          throw new Error("OAuth failed: Code verifier was not found. Please try again.");
      }
      sessionStorage.removeItem('airtable_code_verifier');

      const cleanClientId = clientId.trim();
      
      const params = new URLSearchParams({
          client_id: cleanClientId,
          redirect_uri: REDIRECT_URI,
          code: code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
      });
      
      const proxiedTokenUrl = `${CORS_PROXY_URL}${encodeURIComponent(AIRTABLE_TOKEN_URL)}`;
      
      const response = await safeFetch(proxiedTokenUrl, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString(),
      });
      
      if (!response.ok) {
          const errorData = await response.json();
          const errorMessage = errorData.error_description || errorData.error || response.statusText;
          throw new Error(`Airtable token exchange failed: ${errorMessage}`);
      }
      
      const tokenData = await response.json();
      return {
          airtable_access_token: tokenData.access_token,
          airtable_refresh_token: tokenData.refresh_token,
          airtable_token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
          airtable_api_key: null,
      };
  },

  refreshToken: async (client: Client, settings: SystemSettings): Promise<Partial<Client>> => {
    const cleanClientId = settings.airtable_client_id?.trim();
    if (!client.airtable_refresh_token || !cleanClientId) {
        throw new Error("Missing credentials for token refresh.");
    }
    
    const params = new URLSearchParams({
        client_id: cleanClientId,
        refresh_token: client.airtable_refresh_token,
        grant_type: 'refresh_token',
    });
    
    const proxiedTokenUrl = `${CORS_PROXY_URL}${encodeURIComponent(AIRTABLE_TOKEN_URL)}`;
    
    const response = await safeFetch(proxiedTokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString(),
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("Airtable token refresh failed:", errorData);
        const errorMessage = errorData.error_description || errorData.error || 'Please re-authenticate.';
        throw new Error(`Airtable token refresh failed: ${errorMessage}`);
    }

    const tokenData = await response.json();
    return {
        airtable_access_token: tokenData.access_token,
        airtable_refresh_token: tokenData.refresh_token,
        airtable_token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
    };
  },

  /**
   * Gets a valid authentication token, refreshing it if necessary.
   * @returns An object with the valid access token and any new tokens to save.
   */
  getAuthToken: async (
    client: Client, 
    settings: SystemSettings
  ): Promise<{ accessToken: string; newTokensToSave?: Partial<Client> }> => {
      // Prioritize OAuth access token
      if (client.airtable_access_token) {
          if (client.airtable_token_expires_at && new Date() >= new Date(client.airtable_token_expires_at)) {
              console.log("Airtable access token has expired. Attempting to refresh...");
              const newTokens = await airtableService.refreshToken(client, settings);
              return { accessToken: newTokens.airtable_access_token!, newTokensToSave: newTokens };
          }
          return { accessToken: client.airtable_access_token };
      }
      // Fallback to Personal Access Token
      if (client.airtable_api_key) {
          return { accessToken: client.airtable_api_key };
      }
      throw new Error("No Airtable authentication method configured for this client.");
  },

  /**
   * Fetches all records from the Airtable base/table.
   * Handles pagination automatically to retrieve more than 100 records.
   */
  getRecords: async (client: Client, settings: SystemSettings): Promise<{ id: string, name: string, createdTime: string, source_modified_at: string }[]> => {
    const { accessToken } = await airtableService.getAuthToken(client, settings);
    const baseUrl = `https://api.airtable.com/v0/${client.airtable_base_id}/${client.airtable_table_id}`;
    
    let allRecords: any[] = [];
    let offset: string | undefined;

    try {
        do {
            const params = new URLSearchParams();
            if (offset) params.append('offset', offset);
            // Cache busting
            params.append('_t', Date.now().toString());
            
            const targetUrl = `${baseUrl}?${params.toString()}`;
            // Proxy the data request to avoid CORS
            const proxiedUrl = `${CORS_PROXY_URL}${encodeURIComponent(targetUrl)}`;
            
            const response = await safeFetch(proxiedUrl, { 
                headers: { 'Authorization': `Bearer ${accessToken}` } 
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Airtable API error: ${errorData.error?.message || 'Failed to fetch records'} (Code: ${response.status})`);
            }

            const data = await response.json();
            allRecords = [...allRecords, ...data.records];
            offset = data.offset;

        } while (offset);

        return allRecords.map((record: any) => ({ 
            id: record.id, 
            name: findPrimaryFieldName(record),
            createdTime: record.createdTime,
            source_modified_at: findModifiedTime(record)
        }));

    } catch (error) {
        console.error("Failed to fetch records from Airtable:", error);
        throw error;
    }
  },

  getRecordContent: async (client: Client, settings: SystemSettings, recordId: string): Promise<string> => {
    const { accessToken } = await airtableService.getAuthToken(client, settings);
    const url = `https://api.airtable.com/v0/${client.airtable_base_id}/${client.airtable_table_id}/${recordId}?_t=${Date.now()}`;
    
    // Proxy the data request to avoid CORS
    const proxiedUrl = `${CORS_PROXY_URL}${encodeURIComponent(url)}`;
    
    try {
      const response = await safeFetch(proxiedUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      if (!response.ok) {
        // Pass through status code for 404 detection
        const errorData = await response.json();
        throw new Error(`${response.status} Airtable API error: ${errorData.error?.message || 'Failed to fetch record content'}`);
      }
      const record = await response.json();
      return JSON.stringify(record.fields, null, 2);
    } catch (error) {
        console.error(`Failed to fetch content for Airtable record ${recordId}:`, error);
        throw error;
    }
  },
};
