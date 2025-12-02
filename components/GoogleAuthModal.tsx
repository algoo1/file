
import React, { useState } from 'react';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { ClipboardIcon } from './icons/ClipboardIcon.tsx';
import { SystemSettings } from '../types.ts';

interface GoogleAuthModalProps {
  onClose: () => void;
  initialSettings: SystemSettings;
  isConnected: boolean;
  onConnect: (creds: { apiKey: string; clientId: string; clientSecret: string }) => Promise<void>;
}

const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  onClose,
  initialSettings,
  isConnected,
  onConnect,
}) => {
  const [apiKey, setApiKey] = useState(initialSettings.google_api_key || '');
  const [clientId, setClientId] = useState(initialSettings.google_client_id || '');
  const [clientSecret, setClientSecret] = useState(initialSettings.google_client_secret || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [copiedOrigin1, setCopiedOrigin1] = useState(false);
  const [copiedOrigin2, setCopiedOrigin2] = useState(false);

  const currentOrigin = window.location.origin;
  const userDomain = 'https://n8nexus.site'; // Or whatever domain you are deploying to

  const handleConnect = async () => {
    if (!apiKey || !clientId || !clientSecret) {
        alert("Please fill in all fields.");
        return;
    }
    setIsConnecting(true);
    try {
      await onConnect({ apiKey, clientId, clientSecret });
      // On success, the modal will be closed by the parent component
    } catch (error) {
      // Error is alerted in the parent component
    } finally {
      setIsConnecting(false);
    }
  };
  
  const copyToClipboard = (text: string, originIndex: 1 | 2) => {
    navigator.clipboard.writeText(text);
    if (originIndex === 1) {
        setCopiedOrigin1(true);
        setTimeout(() => setCopiedOrigin1(false), 2000);
    } else {
        setCopiedOrigin2(true);
        setTimeout(() => setCopiedOrigin2(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-lg shadow-2xl p-6 border border-gray-700 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <DriveIcon className="w-6 h-6 text-blue-400" />
            Setup Google Drive Integration (Persistent Auth)
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
        </div>

        <div className="overflow-y-auto pr-2 flex-grow">
            <div className="bg-blue-900/20 border border-blue-500/30 p-3 rounded-md mb-4 text-xs text-blue-300">
                To prevent asking for login every time, we now use a secure "Offline Access" flow. This requires your <strong>Client Secret</strong>. It will be stored securely in your database.
            </div>

            <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Google API Key</label>
                <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Google Cloud API Key"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Google Client ID</label>
                <input
                type="password"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter your OAuth 2.0 Client ID"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Google Client Secret</label>
                <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Enter your OAuth 2.0 Client Secret"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                />
            </div>
            </div>

            <div className="bg-gray-900/50 p-4 rounded-md mt-6 border border-gray-700">
                <h3 className="text-md font-semibold text-gray-200 mb-2">Required Google Cloud Console Setup</h3>
                <ol className="list-decimal list-inside text-sm space-y-4 text-gray-300">
                    <li>
                        <strong>Create Credentials</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">
                             Use <a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-400 underline">Google Console</a>.
                             Create an "OAuth client ID" (Web application).
                             Copy the Client ID and Client Secret.
                        </p>
                    </li>
                    <li>
                        <strong>Add Authorized JavaScript Origins</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">Add your current URL to "Authorized JavaScript origins":</p>
                        <div className="text-xs space-y-1 mt-2 ml-8 font-mono bg-gray-900 p-2 rounded-md">
                             <div className="flex items-center justify-between gap-2">
                                <span>{currentOrigin}</span>
                                <button type="button" onClick={() => copyToClipboard(currentOrigin, 2)} className="text-xs bg-gray-700 px-2 py-1 rounded">Copy</button>
                            </div>
                        </div>
                    </li>
                    <li>
                        <strong>Add Authorized Redirect URIs (Critical)</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">
                            You <strong>MUST</strong> add the exact same URL to "Authorized redirect URIs".
                        </p>
                    </li>
                </ol>
            </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={handleConnect}
            disabled={isConnecting || !apiKey || !clientId || !clientSecret}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
          >
            {isConnecting ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </>
            ) : isConnected ? 'Reconnect to Google Drive' : 'Save & Connect'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthModal;
