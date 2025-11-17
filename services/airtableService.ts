// This service handles all interactions with the Airtable API.
import { Client } from '../types.ts';

const AIRTABLE_AUTH_URL = 'https://airtable.com/oauth2/v1/authorize';
const AIRTABLE_TOKEN_URL = 'https://airtable.com/oauth2/v1/token';
const REDIRECT_URI = window.location.origin + window.location.pathname;

const findPrimaryFieldName = (record: any): string => {
    const commonNames = ['Name', 'Title', 'ID', 'Primary', 'Key', 'Task'];
    if (record && record.fields) {
        for (const name of commonNames) {
            if (name in record.fields) return record.fields[name] || record.id;
        }
        for(const key in record.fields) {
            if(typeof record.fields[key] === 'string' && record.fields[key]) return record.fields[key];
        }
    }
    return record.id;
};

// PKCE Helper Functions
const generateCodeVerifier = (): string => {
    const array = new Uint32Array(28);
    window.crypto.getRandomValues(array);
    return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
};

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
};

const base64urlencode = (a: ArrayBuffer): string => {
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(a))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'data.records:read',
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

      const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code: code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
      });
      
      const response = await fetch(AIRTABLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
      });
      
      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Airtable token exchange failed: ${errorData.error_description || response.statusText}`);
      }
      
      const tokenData = await response.json();
      return {
          airtableAccessToken: tokenData.access_token,
          airtableRefreshToken: tokenData.refresh_token,
          airtableTokenExpiresAt: Date.now() + (tokenData.expires_in * 1000),
          // Clear PAT on successful OAuth
          airtableApiKey: null,
      };
  },

  /**
   * Gets a valid authentication token, refreshing it if necessary.
   * @param client The client object.
   * @param airtableClientId The system-wide Airtable Client ID.
   * @returns The valid auth token (could be PAT or access token).
   */
  getAuthToken: async (client: Client, airtableClientId: string): Promise<string> => {
      // Prioritize OAuth access token
      if (client.airtableAccessToken) {
          if (client.airtableTokenExpiresAt && Date.now() >= client.airtableTokenExpiresAt) {
              // TODO: Implement token refresh logic if needed
              console.warn("Airtable access token has expired. Re-authentication is required.");
              throw new Error("Airtable token expired. Please reconnect.");
          }
          return client.airtableAccessToken;
      }
      // Fallback to Personal Access Token
      if (client.airtableApiKey) {
          return client.airtableApiKey;
      }
      throw new Error("No Airtable authentication method configured for this client.");
  },

  getRecords: async (client: Client, airtableClientId: string): Promise<{ id: string, name: string }[]> => {
    const authToken = await airtableService.getAuthToken(client, airtableClientId);
    const url = `https://api.airtable.com/v0/${client.airtableBaseId}/${client.airtableTableId}`;
    try {
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Airtable API error: ${errorData.error?.message || 'Failed to fetch records'} (Code: ${response.status})`);
      }
      const data = await response.json();
      return data.records.map((record: any) => ({ id: record.id, name: findPrimaryFieldName(record) }));
    } catch (error) {
        console.error("Failed to fetch records from Airtable:", error);
        throw error;
    }
  },

  getRecordContent: async (client: Client, airtableClientId: string, recordId: string): Promise<string> => {
    const authToken = await airtableService.getAuthToken(client, airtableClientId);
    const url = `https://api.airtable.com/v0/${client.airtableBaseId}/${client.airtableTableId}/${recordId}`;
    try {
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Airtable API error: ${errorData.error?.message || 'Failed to fetch record content'} (Code: ${response.status})`);
      }
      const record = await response.json();
      return JSON.stringify(record.fields, null, 2);
    } catch (error) {
        console.error(`Failed to fetch content for Airtable record ${recordId}:`, error);
        throw error;
    }
  },
};
