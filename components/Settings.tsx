import React from 'react';
import { SettingsIcon } from './icons/SettingsIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';

interface SettingsProps {
  fileSearchApiKey: string;
  setFileSearchApiKey: (key: string) => void;
  isGoogleDriveConnected: boolean;
  onOpenAuthModal: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  fileSearchApiKey,
  setFileSearchApiKey,
  isGoogleDriveConnected,
  onOpenAuthModal,
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

        <div className="border-t border-gray-700 pt-4">
           <h3 className="text-md font-semibold text-gray-300 mb-2">Integrations</h3>
            <button
                onClick={onOpenAuthModal}
                className={`w-full flex items-center justify-center gap-2 font-semibold py-2 px-4 rounded-md transition-colors ${
                    isGoogleDriveConnected 
                    ? 'bg-green-600/80 text-white cursor-default' 
                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
            >
                <DriveIcon className="w-5 h-5" />
                {isGoogleDriveConnected ? 'Google Drive Connected' : 'Setup Google Drive Integration'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;