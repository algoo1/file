
import React from 'react';
import { SettingsIcon } from './icons/SettingsIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';

interface SettingsProps {
  fileSearchApiKey: string;
  setFileSearchApiKey: (key: string) => void;
  isGoogleDriveConnected: boolean;
  onConnectGoogleDrive: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  fileSearchApiKey,
  setFileSearchApiKey,
  isGoogleDriveConnected,
  onConnectGoogleDrive,
}) => {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg">
      <h2 className="text-lg font-semibold mb-3 text-white flex items-center gap-2">
        <SettingsIcon className="w-5 h-5" />
        Settings
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
        <div>
           <label className="block text-sm font-medium text-gray-400 mb-1">
            Integrations
          </label>
          <button
            onClick={onConnectGoogleDrive}
            disabled={isGoogleDriveConnected}
            className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:bg-green-600/50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-md transition-colors"
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