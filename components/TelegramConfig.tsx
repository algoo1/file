
import React, { useState } from 'react';
import { Client } from '../types.ts';
import { apiService } from '../services/apiService.ts';

interface TelegramConfigProps {
    client: Client;
    onUpdate: (updatedClient: Client) => void;
}

const TelegramConfig: React.FC<TelegramConfigProps> = ({ client, onUpdate }) => {
    const [botToken, setBotToken] = useState(client.telegram_bot_token || '');
    const [chatIds, setChatIds] = useState(client.telegram_allowed_chat_ids || '');
    const [isSaving, setIsSaving] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updated = await apiService.updateClient(client.id, {
                telegram_bot_token: botToken,
                telegram_allowed_chat_ids: chatIds
            });
            onUpdate(updated);
            alert("Telegram settings saved.");
            setIsOpen(false);
        } catch (e) {
            alert("Failed to save settings.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="mt-4 border-t border-gray-700 pt-4">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 font-semibold text-sm w-full"
            >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-1-2.23-1.5-.87-.58-.33-1.18.15-1.65.65-.63 2.97-2.73 3.03-2.95.06-.21-.05-.43-.45-.25-2.24 1.34-3.8 2.3-5.2 3.12-.55.33-1.65.65-2.15.5-.55-.16-1.3-.27-1.3-.27s-.65-.43 1.05-1.08c6.58-2.58 8.65-3.48 9.25-3.7.8-.3 1.25-.28 1.25.26z"/></svg>
                Telegram Bot Integration
                <span className="text-gray-500 text-xs ml-auto">{isOpen ? 'Hide' : 'Configure'}</span>
            </button>
            
            {isOpen && (
                <div className="mt-3 bg-gray-900/50 p-4 rounded-md space-y-3">
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Bot Token</label>
                        <input 
                            type="password"
                            value={botToken}
                            onChange={e => setBotToken(e.target.value)}
                            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Allowed Chat IDs (comma separated)</label>
                        <input 
                            type="text"
                            value={chatIds}
                            onChange={e => setChatIds(e.target.value)}
                            placeholder="12345678, 87654321"
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded text-sm transition-colors"
                    >
                        {isSaving ? 'Saving...' : 'Save Configuration'}
                    </button>
                    <p className="text-xs text-gray-500 mt-2">
                        * Use these credentials in your n8n workflow or automation server to authorize commands sent to this system.
                    </p>
                </div>
            )}
        </div>
    );
};

export default TelegramConfig;
