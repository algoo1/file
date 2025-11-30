
import React, { useState } from 'react';
import { Client } from '../types.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';

interface ClientManagerProps {
  clients: Client[];
  selectedClientId: string | null;
  onAddClient: (name: string) => void;
  onSelectClient: (id: string) => void;
}

const ClientManager: React.FC<ClientManagerProps> = ({ clients, selectedClientId, onAddClient, onSelectClient }) => {
  const [newClientName, setNewClientName] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    onAddClient(newClientName);
    setNewClientName('');
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-lg">
      <h2 className="text-lg font-semibold mb-3 text-white">Clients</h2>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          type="text"
          value={newClientName}
          onChange={(e) => setNewClientName(e.target.value)}
          placeholder="New Client Name"
          className="flex-grow bg-gray-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed" disabled={!newClientName.trim()}>
          <PlusIcon className="w-5 h-5" />
        </button>
      </form>
      <div className="max-h-48 overflow-y-auto mb-2">
        {clients.length > 0 ? (
            <ul className="space-y-2">
            {clients.map(client => (
                <li key={client.id}>
                <button
                    onClick={() => onSelectClient(client.id)}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors text-sm ${
                    selectedClientId === client.id
                        ? 'bg-blue-500/30 text-blue-300 font-semibold'
                        : 'bg-gray-700/50 hover:bg-gray-600/50 text-gray-300'
                    }`}
                >
                    {client.name}
                </button>
                </li>
            ))}
            </ul>
        ) : (
            <p className="text-gray-500 text-sm text-center py-4">No clients yet.</p>
        )}
      </div>
    </div>
  );
};

export default ClientManager;