import React, { useState, useEffect } from 'react';
import { SettingsIcon } from './icons/SettingsIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { CheckIcon } from './icons/CheckIcon.tsx';
import { SystemSettings } from '../types.ts';

interface SettingsProps {
  settings: SystemSettings | null;
  onSave: (settings: Partial<SystemSettings>) => Promise<any>;
  onOpenGoogleAuthModal: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  settings,
  onSave,
  onOpenGoogleAuthModal,
}) => {
  const [localApiKey, setLocalApiKey] = useState(settings?.file_search_service_api_key || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setLocalApiKey(settings?.file_search_service_api_key || '');
  }, [settings?.file_search_service_api_key]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onSave({ file_search_service_api_key: localApiKey });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      // Error is alerted in App.tsx
    } finally {
      setIsSaving(false);
    }
  };

  const hasUnsavedChanges = localApiKey !== (settings?.file_search_service_api_key || '');

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg">
      <h2 className="text-lg font-semibold mb-3 text-white flex items-center gap-2">
        <SettingsIcon className="w-5 h-5" />
        Settings
      </h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-400 mb-1 flex items-center justify-between">
            <span>File Search Service API Key</span>
            {settings?.file_search_service_api_key && !hasUnsavedChanges && (
                <span className="text-green-400 flex items-center gap-1 text-xs" title="API Key is saved">
                    <CheckIcon className="w-4 h-4" />
                    Saved
                </span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              id="apiKey"
              type="password"
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              placeholder="Enter your Gemini API Key"
              className="flex-grow w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !localApiKey.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md transition-colors text-sm disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {saveSuccess && <p className="text-xs text-green-400 mt-1">API Key saved successfully!</p>}
        </div>

        <div className="border-t border-gray-700 pt-4">
           <h3 className="text-md font-semibold text-gray-300 mb-2">Integrations</h3>
            <div className="space-y-2">
                <button
                    onClick={onOpenGoogleAuthModal}
                    className={`w-full flex items-center justify-center gap-2 font-semibold py-2 px-4 rounded-md transition-colors ${
                        settings?.is_google_drive_connected 
                        ? 'bg-green-600/80 text-white' 
                        : 'bg-gray-700 hover:bg-gray-600 text-white'
                    }`}
                >
                    <DriveIcon className="w-5 h-5" />
                    {settings?.is_google_drive_connected ? 'Google Drive Connected' : 'Setup Google Drive Integration'}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;