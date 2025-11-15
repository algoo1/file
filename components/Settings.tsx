
import React from 'react';
import { SettingsIcon } from './icons/SettingsIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';

interface SettingsProps {
  fileSearchApiKey: string;
  setFileSearchApiKey: (key: string) => void;
  googleApiKey: string;
  setGoogleApiKey: (key: string) => void;
  googleClientId: string;
  setGoogleClientId: (id: string) => void;
  googleClientSecret: string;
  setGoogleClientSecret: (secret: string) => void;
  isGoogleDriveConnected: boolean;
  onConnectGoogleDrive: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  fileSearchApiKey,
  setFileSearchApiKey,
  googleApiKey,
  setGoogleApiKey,
  googleClientId,
  setGoogleClientId,
  googleClientSecret,
  setGoogleClientSecret,
  isGoogleDriveConnected,
  onConnectGoogleDrive,
}) => {
  const currentOrigin = window.location.origin;
  const userDomain = 'https://n8nexus.site';
  
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg">
      <h2 className="text-lg font-semibold mb-3 text-white flex items-center gap-2">
        <SettingsIcon className="w-5 h-5" />
        Settings & Credentials
      </h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-400 mb-1">
            File Search API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={fileSearchApiKey}
            onChange={(e) => setFileSearchApiKey(e.target.value)}
            placeholder="Enter your API Key"
            className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
          />
        </div>

        <div className="border-t border-gray-700 pt-4">
          <h3 className="text-md font-semibold text-gray-300 mb-3">Google Drive Integration</h3>
          <div className="space-y-4">
             <div>
              <label htmlFor="googleApiKey" className="block text-sm font-medium text-gray-400 mb-1">
                Google API Key
              </label>
              <input
                id="googleApiKey"
                type="password"
                value={googleApiKey}
                onChange={(e) => setGoogleApiKey(e.target.value)}
                placeholder="Enter your Google API Key"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
              />
            </div>
            <div>
              <label htmlFor="googleClientId" className="block text-sm font-medium text-gray-400 mb-1">
                Google Client ID
              </label>
              <input
                id="googleClientId"
                type="password"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder="Enter your Google Client ID"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
              />
            </div>
            <div>
              <label htmlFor="googleClientSecret" className="block text-sm font-medium text-gray-400 mb-1">
                Google Client Secret
              </label>
              <input
                id="googleClientSecret"
                type="password"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder="Enter your Google Client Secret"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
              />
              <p className="text-xs text-gray-500 mt-1">
                <span className="font-bold">Security Note:</span> The Client Secret is for backend tools like n8n and is <span className="underline">not used</span> by this client-side application.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4">
            <h3 className="text-md font-semibold text-gray-300 mb-2">Required Google Cloud Console Setup</h3>
            <div className="bg-gray-900/50 p-3 rounded-md text-sm space-y-2 border border-gray-600">
                <p className="text-gray-400">For OAuth 2.0 to work, add the following URLs to your Google Cloud project's credentials under <span className="font-semibold text-gray-300">"Authorized JavaScript origins"</span>:</p>
                <ul className="list-disc list-inside text-gray-300 font-mono text-xs space-y-1">
                    <li>{userDomain}</li>
                    {currentOrigin !== userDomain && <li>{currentOrigin}</li>}
                </ul>
            </div>
        </div>
        
        <div>
          <button
            onClick={onConnectGoogleDrive}
            disabled={isGoogleDriveConnected || !googleApiKey || !googleClientId}
            className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:bg-green-600/50 disabled:text-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-md transition-colors"
          >
            <DriveIcon className="w-5 h-5" />
            {isGoogleDriveConnected ? 'Google Drive Connected' : 'Connect to Google Drive'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;