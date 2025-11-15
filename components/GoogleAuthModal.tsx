import React from 'react';
import { DriveIcon } from './icons/DriveIcon.tsx';

interface GoogleAuthModalProps {
  onClose: () => void;
  googleApiKey: string;
  setGoogleApiKey: (key: string) => void;
  googleClientId: string;
  setGoogleClientId: (id: string) => void;
  googleClientSecret: string;
  setGoogleClientSecret: (secret: string) => void;
  isGoogleDriveConnected: boolean;
  onConnectGoogleDrive: () => void;
  apiScriptsLoaded: boolean;
}

const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  onClose,
  googleApiKey,
  setGoogleApiKey,
  googleClientId,
  setGoogleClientId,
  googleClientSecret,
  setGoogleClientSecret,
  isGoogleDriveConnected,
  onConnectGoogleDrive,
  apiScriptsLoaded
}) => {
  const currentOrigin = window.location.origin;
  const userDomain = 'https://n8nexus.site';

  return (
    <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
    >
      <div 
        className="bg-gray-800 rounded-lg p-6 border border-gray-700 shadow-2xl w-full max-w-lg relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
        
        <h2 className="text-xl font-semibold mb-4 text-white">Google Drive Integration Setup</h2>
        
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

        <div className="border-t border-gray-700 pt-4 mt-6">
          <h3 className="text-md font-semibold text-gray-300 mb-2">Required Google Cloud Console Setup</h3>
          <div className="bg-gray-900/50 p-3 rounded-md text-sm space-y-2 border border-gray-600">
            <p className="text-gray-400">For OAuth 2.0 to work, add the following URLs to your Google Cloud project's credentials under <span className="font-semibold text-gray-300">"Authorized JavaScript origins"</span>:</p>
            <ul className="list-disc list-inside text-gray-300 font-mono text-xs space-y-1">
              <li>{userDomain}</li>
              {currentOrigin !== userDomain && <li>{currentOrigin}</li>}
            </ul>
          </div>
        </div>
        
        <div className="mt-6">
          <button
            onClick={onConnectGoogleDrive}
            disabled={isGoogleDriveConnected || !googleApiKey || !googleClientId || !apiScriptsLoaded}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-md transition-colors"
          >
            <DriveIcon className="w-5 h-5" />
            {isGoogleDriveConnected ? 'Successfully Connected' : (apiScriptsLoaded ? 'Connect to Google Drive' : 'Loading Google Scripts...')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthModal;
