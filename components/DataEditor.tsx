
import React, { useState, useRef } from 'react';
import { Client, SyncedFile } from '../types.ts';
import { googleDriveService } from '../services/googleDriveService.ts';
import { dataEditorService } from '../services/dataEditorService.ts';
import { apiService } from '../services/apiService.ts';
import { SheetIcon } from './icons/SheetIcon.tsx';
import { CheckCircleIcon } from './icons/CheckCircleIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';

interface DataEditorProps {
    client: Client;
    fileSearchApiKey: string;
    onSyncNow: (clientId: string) => Promise<void>;
}

const DataEditor: React.FC<DataEditorProps> = ({ client, fileSearchApiKey, onSyncNow }) => {
    const [selectedFileId, setSelectedFileId] = useState<string>('');
    const [instruction, setInstruction] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [preview, setPreview] = useState<{ explanation: string; updatedCsv: string; originalCsv: string } | null>(null);
    const [executionStatus, setExecutionStatus] = useState<'idle' | 'updating' | 'success' | 'error'>('idle');
    const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Filter only Google Sheets (which act as our database tables)
    const sheetFiles = client.synced_files.filter(f => f.type === 'sheet' && f.source === 'GOOGLE_DRIVE');

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                setSelectedImage({ data: base64String, mimeType: file.type });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGeneratePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedFileId || !instruction) return;
        
        setIsLoading(true);
        setPreview(null);
        setExecutionStatus('idle');

        try {
            const file = sheetFiles.find(f => f.id === selectedFileId);
            if (!file) throw new Error("File not found");

            // 1. Fetch current content (Live from Drive to ensure we don't overwrite stale data)
            // We need the original meta to get the correct mimeType for download (usually csv export)
            const driveFiles = await googleDriveService.getListOfFiles(client.google_drive_folder_url!);
            const driveMeta = driveFiles.find(df => df.id === file.source_item_id);
            if (!driveMeta) throw new Error("File no longer exists on Drive.");

            const currentContent = await googleDriveService.getFileContent(driveMeta.id, 'application/vnd.google-apps.spreadsheet');

            // 2. Call AI
            const plan = await dataEditorService.generateEditPlan(
                currentContent, 
                instruction, 
                fileSearchApiKey, 
                selectedImage || undefined
            );

            setPreview({
                explanation: plan.explanation,
                updatedCsv: plan.updatedCsv,
                originalCsv: currentContent
            });

        } catch (error) {
            alert(`Error: ${error instanceof Error ? error.message : 'Failed to generate plan'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExecute = async () => {
        if (!preview || !selectedFileId) return;
        const file = sheetFiles.find(f => f.id === selectedFileId);
        if (!file) return;

        setExecutionStatus('updating');
        try {
            // 1. Update Drive
            await googleDriveService.updateFileContent(file.source_item_id, preview.updatedCsv, 'text/csv');
            
            // 2. Trigger Sync to update our local index
            await onSyncNow(client.id);

            setExecutionStatus('success');
            setTimeout(() => {
                setPreview(null);
                setInstruction('');
                setSelectedImage(null);
                setExecutionStatus('idle');
            }, 3000);
        } catch (error) {
            console.error(error);
            setExecutionStatus('error');
            alert("Failed to update file on Google Drive.");
        }
    };

    if (sheetFiles.length === 0) {
        return (
            <div className="bg-gray-800 p-6 rounded-lg text-center border border-gray-700">
                <SheetIcon className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-white">No Editable Sheets Found</h3>
                <p className="text-gray-400 mt-2">Sync a Google Sheet (CSV compatible) to use the Data Editor.</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-xl overflow-hidden flex flex-col h-full">
            <div className="p-6 bg-gray-800/80 backdrop-blur-md border-b border-gray-700">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="text-blue-400">⚡</span> Smart Data Editor
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                    Modify your product data using natural language. Add, remove, or update rows safely.
                </p>
            </div>

            <div className="p-6 space-y-6 flex-grow overflow-y-auto">
                {/* File Selection */}
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Select Target Sheet</label>
                    <select 
                        value={selectedFileId} 
                        onChange={(e) => { setSelectedFileId(e.target.value); setPreview(null); }}
                        className="w-full bg-gray-900 text-white rounded-md px-4 py-3 border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none appearance-none"
                    >
                        <option value="">-- Choose a file --</option>
                        {sheetFiles.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </select>
                </div>

                {/* Command Input */}
                {selectedFileId && (
                    <form onSubmit={handleGeneratePlan} className="space-y-3">
                         <div className="flex flex-col gap-2">
                            <label className="block text-sm font-medium text-gray-400">Your Instruction</label>
                            
                            {selectedImage && (
                                <div className="relative w-32 h-32 border border-gray-600 rounded-md overflow-hidden mb-2 group">
                                    <img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} alt="Upload" className="w-full h-full object-cover" />
                                    <button 
                                        type="button" 
                                        onClick={() => setSelectedImage(null)}
                                        className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <textarea
                                    value={instruction}
                                    onChange={(e) => setInstruction(e.target.value)}
                                    placeholder="e.g. 'Change the price of the Leather Bag to $150' or 'Delete the item with ID 405'."
                                    className="flex-grow bg-gray-900 text-white rounded-md px-4 py-3 border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none min-h-[80px]"
                                />
                                <div className="flex flex-col gap-2">
                                    <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} className="hidden" />
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 p-3 rounded-md h-full flex items-center justify-center transition-colors"
                                        title="Attach Image for context (e.g. Add Product)"
                                    >
                                        <ImageIcon className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <button 
                            type="submit" 
                            disabled={isLoading || !instruction.trim()}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-md transition-all disabled:opacity-50 flex justify-center items-center"
                        >
                            {isLoading ? (
                                <span className="animate-pulse">Processing Request...</span>
                            ) : "Analyze & Preview Changes"}
                        </button>
                    </form>
                )}

                {/* Preview Area */}
                {preview && (
                    <div className="bg-gray-900 rounded-lg border border-gray-600 p-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-start gap-4 mb-4">
                            <div className="bg-green-500/20 p-2 rounded-full">
                                <CheckCircleIcon className="w-6 h-6 text-green-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-lg">Proposed Changes</h3>
                                <p className="text-gray-300 mt-1">{preview.explanation}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs font-mono mb-6">
                            <div>
                                <span className="block text-gray-500 mb-1 uppercase tracking-wider">Before</span>
                                <div className="bg-black/50 p-2 rounded h-40 overflow-auto text-red-300/80 whitespace-pre">
                                    {preview.originalCsv}
                                </div>
                            </div>
                            <div>
                                <span className="block text-gray-500 mb-1 uppercase tracking-wider">After</span>
                                <div className="bg-black/50 p-2 rounded h-40 overflow-auto text-green-300 whitespace-pre">
                                    {preview.updatedCsv}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button 
                                onClick={() => setPreview(null)}
                                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                                disabled={executionStatus === 'updating'}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleExecute}
                                disabled={executionStatus === 'updating'}
                                className={`px-6 py-2 rounded-md font-bold text-white transition-colors flex items-center gap-2
                                    ${executionStatus === 'updating' ? 'bg-gray-600 cursor-not-allowed' : 
                                      executionStatus === 'success' ? 'bg-green-600' : 'bg-green-600 hover:bg-green-700'}
                                `}
                            >
                                {executionStatus === 'updating' ? 'Executing Update...' : 
                                 executionStatus === 'success' ? 'Update Complete!' : 'Confirm & Execute'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DataEditor;
