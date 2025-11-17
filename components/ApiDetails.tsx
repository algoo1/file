import React, { useState } from 'react';
import { Client } from '../types.ts';
import { ClipboardIcon } from './icons/ClipboardIcon.tsx';

interface ApiDetailsProps {
  client: Client;
}

const ApiDetails: React.FC<ApiDetailsProps> = ({ client }) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const endpoint = `${window.location.origin}/api/v1/search`; 
  
  // Use the API key in the header for auth/identification, simplifying the payload.
  const curlCommand = `curl "${endpoint}" \\
  -H "x-api-key: ${client.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Your question here"
  }'`;

  const copyToClipboard = (text: string, type: 'key' | 'curl') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 shadow-lg">
      <h2 className="text-xl font-semibold mb-4 text-white">API Access for n8n / Other Tools</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Client API Key</label>
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              readOnly 
              value={client.apiKey} 
              className="flex-grow bg-gray-700 text-white font-mono text-sm rounded-md px-3 py-2 border border-gray-600 select-all"
            />
            <button onClick={() => copyToClipboard(client.apiKey, 'key')} className="bg-gray-600 hover:bg-gray-500 text-white font-bold p-2 rounded-md transition-colors">
              <ClipboardIcon className={`w-5 h-5 ${copiedKey ? 'text-green-400' : ''}`} />
            </button>
          </div>
          {copiedKey && <p className="text-xs text-green-400 mt-1">Copied!</p>}
        </div>

        <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Example cURL Request</label>
            <div className="relative bg-gray-900 rounded-md p-4 text-sm font-mono text-gray-300 border border-gray-700">
                <button 
                  onClick={() => copyToClipboard(curlCommand, 'curl')}
                  className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white font-bold p-2 rounded-md transition-colors"
                >
                  <ClipboardIcon className={`w-5 h-5 ${copiedCurl ? 'text-green-400' : ''}`} />
                </button>
                <pre className="whitespace-pre-wrap break-all"><code>{curlCommand}</code></pre>
            </div>
            {copiedCurl && <p className="text-xs text-green-400 mt-1">Copied!</p>}
        </div>
      </div>
    </div>
  );
};

export default ApiDetails;