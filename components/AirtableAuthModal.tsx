import React, { useState } from 'react';
import { AirtableIcon } from './icons/AirtableIcon.tsx';
import { ClipboardIcon } from './icons/ClipboardIcon.tsx';
import { SystemSettings } from '../types.ts';

interface AirtableAuthModalProps {
  onClose: () => void;
  initialSettings: SystemSettings;
  onSave: (clientId: string) => Promise<void>;
}

const AirtableAuthModal: React.FC<AirtableAuthModalProps> = ({
  onClose,
  initialSettings,
  onSave,
}) => {
  const [clientId, setClientId] = useState(initialSettings.airtable_client_id || '');
  const [isSaving, setIsSaving] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  const redirectUri = window.location.origin + window.location.pathname;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(clientId);
      // On success, the modal will be closed by the parent component
    } catch (error) {
      // Error is alerted in the parent component
    } finally {
      setIsSaving(false);
    }
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-lg shadow-2xl p-6 border border-gray-700 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <AirtableIcon className="w-6 h-6 text-yellow-400" />
            Setup Airtable Integration
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
        </div>

        <div className="overflow-y-auto pr-2 flex-grow">
            <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Airtable Client ID</label>
                <input
                type="password"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter your Airtable OAuth App Client ID"
                className="w-full bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                />
            </div>
            </div>

            <div className="bg-gray-900/50 p-4 rounded-md mt-6 border border-gray-700">
                <h3 className="text-md font-semibold text-gray-200 mb-2">Required Airtable Setup</h3>
                <p className="text-sm text-gray-400 mb-3">To connect via OAuth, you must first create a new OAuth app in your Airtable developer settings.</p>
                <ol className="list-decimal list-inside text-sm space-y-4 text-gray-300">
                    <li>
                        <strong>Create a new OAuth app</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">Go to the Airtable developer hub and create a new OAuth application.</p>
                        <a href="https://airtable.com/create/oauth" target="_blank" rel="noopener noreferrer" className="text-xs ml-4 text-blue-400 hover:underline">
                            Open Airtable Developer Hub &rarr;
                        </a>
                    </li>
                    <li>
                        <strong>Configure Redirect URI</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">In your new Airtable app's settings, you must add the following URL to the list of "Redirect URIs":</p>
                        <div className="text-xs mt-2 ml-8 font-mono bg-gray-900 p-2 rounded-md">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-green-400 break-all">{redirectUri}</span>
                                <button type="button" onClick={() => copyToClipboard(redirectUri)} title="Copy URL" className="flex-shrink-0 flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600">
                                    <ClipboardIcon className={`w-4 h-4 ${copiedUri ? 'text-green-400' : ''}`} />
                                    <span>{copiedUri ? 'Copied!' : 'Copy'}</span>
                                </button>
                            </div>
                        </div>
                    </li>
                     <li>
                        <strong>Copy the Client ID</strong>
                        <p className="text-xs text-gray-400 ml-4 mt-1">After saving your app configuration, Airtable will provide a Client ID. Copy it and paste it into the field above.</p>
                    </li>
                </ol>
            </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={handleSave}
            disabled={isSaving || !clientId}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Airtable Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AirtableAuthModal;
