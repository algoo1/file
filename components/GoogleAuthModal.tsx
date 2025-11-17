import React, { useState } from 'react';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { ClipboardIcon } from './icons/ClipboardIcon.tsx';
import { SystemSettings } from '../types.ts';

interface GoogleAuthModalProps {
  onClose: () => void;
  initialSettings: SystemSettings;
  isConnected: boolean;
  onConnect: (creds: { apiKey: string; clientId: string; }) => Promise<void>;
}

const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  onClose,
  initialSettings,
  isConnected,
  onConnect,
}) => {
  const [apiKey, setApiKey] = useState(initialSettings.google_api_key || '');
  const [clientId, setClientId] = useState(initialSettings.google_client_id || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [copiedOrigin1, setCopiedOrigin1] = useState(false);
  const [copiedOrigin2, setCopiedOrigin2] = useState(false);

  const currentOrigin = window.location.origin;
  const userDomain = 'https://n8nexus.site';

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await onConnect({ apiKey, clientId });
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
            Setup Google Drive Integration
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
        </div>

        <div className="overflow-y-auto pr-2 flex-grow">
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
                placeholder="Enter your Google Cloud OAuth Client ID"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                />
            </div>
            </div>

            <div className="bg-gray-900/50 p-4 rounded-md mt-6 border border-gray-700">
                <h3 className="text-md font-semibold text-gray-200 mb-2">Required Google Cloud Console Setup</h3>
                <p className="text-sm text-gray-400 mb-3">Follow these steps carefully in your Google Cloud Project. It can take a few minutes for Google's settings to update after saving.</p>
                <ol className="list-decimal list-inside text-sm space-y-4 text-gray-300">
                    <li>
                        <strong>Enable the Google Drive API</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">Go to the Google Drive API page and click "Enable".</p>
                        <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer" className="text-xs ml-4 text-blue-400 hover:underline">
                            Open Google Drive API Library &rarr;
                        </a>
                    </li>
                    <li>
                        <strong>Create Credentials</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">Go to the Credentials page to create an API Key and OAuth Client ID.</p>
                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-xs ml-4 text-blue-400 hover:underline">
                            Open Credentials Page &rarr;
                        </a>
                        <ul className="list-disc list-inside text-xs text-gray-400 ml-8 mt-2 space-y-2">
                            <li>
                                <strong>API Key:</strong> Click "CREATE CREDENTIALS" &rarr; "API key". Paste this key into the "Google API Key" field above. For security, you should restrict it to "HTTP referrers" and add the URLs from Step 3.
                            </li>
                            <li>
                                <strong>OAuth 2.0 Client ID:</strong> Click "CREATE CREDENTIALS" &rarr; "OAuth client ID". Choose "Web application". Paste the "Client ID" into the "Google Client ID" field above.
                            </li>
                        </ul>
                    </li>
                    <li>
                        <strong>Add Authorized JavaScript Origins</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">In your <strong className="text-gray-300">OAuth Client ID</strong>'s settings, find the "Authorized JavaScript origins" section and add BOTH of the following URLs:</p>
                        <div className="text-xs space-y-1 mt-2 ml-8 font-mono bg-gray-900 p-2 rounded-md">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-green-400 break-all">{userDomain}</span>
                                <button type="button" onClick={() => copyToClipboard(userDomain, 1)} title="Copy URL" className="flex-shrink-0 flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600">
                                    <ClipboardIcon className={`w-4 h-4 ${copiedOrigin1 ? 'text-green-400' : ''}`} />
                                    <span>{copiedOrigin1 ? 'Copied!' : 'Copy'}</span>
                                </button>
                            </div>
                             <div className="flex items-center justify-between gap-2">
                                <div>
                                    <span className="text-green-400 break-all">{currentOrigin}</span>
                                    <span className="text-blue-400 text-xs font-sans ml-2 whitespace-nowrap">(Your current URL)</span>
                                </div>
                                <button type="button" onClick={() => copyToClipboard(currentOrigin, 2)} title="Copy URL" className="flex-shrink-0 flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600">
                                    <ClipboardIcon className={`w-4 h-4 ${copiedOrigin2 ? 'text-green-400' : ''}`} />
                                    <span>{copiedOrigin2 ? 'Copied!' : 'Copy'}</span>
                                </button>
                            </div>
                        </div>
                    </li>
                </ol>
            </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={handleConnect}
            disabled={isConnecting || !apiKey || !clientId}
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
            ) : isConnected ? 'Reconnect to Google Drive' : 'Save & Connect to Google Drive'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthModal;
