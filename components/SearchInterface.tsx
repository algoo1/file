
import React, { useState, useCallback, useRef } from 'react';
import { Client } from '../types.ts';
import { SearchIcon } from './icons/SearchIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';

type SearchSource = 'ALL' | 'GOOGLE_DRIVE';

interface SearchInterfaceProps {
  client: Client;
  onSearch: (query: string, source: SearchSource, image?: { data: string; mimeType: string }) => Promise<string>;
}

const SearchInterface: React.FC<SearchInterfaceProps> = ({ client, onSearch }) => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [searchSource, setSearchSource] = useState<SearchSource>('ALL');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          setSelectedImage({ data: base64String, mimeType: file.type });
        };
        reader.readAsDataURL(file);
    }
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) processFile(file);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
  };

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() && !selectedImage) return;

    setIsLoading(true);
    setResult('');
    try {
      const response = await onSearch(query, searchSource, selectedImage);
      setResult(response);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "An error occurred while searching. Please try again.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [onSearch, query, selectedImage, searchSource]);
  
  const hasGoogleDrive = !!client.google_drive_folder_url;
  const hasDataSource = hasGoogleDrive;
  const hasContentToSearch = query.trim() || selectedImage;
  const canSearch = !isLoading && hasContentToSearch && hasDataSource;

  const SourceButton: React.FC<{source: SearchSource, label: string, icon: React.ReactNode, enabled: boolean}> = ({ source, label, icon, enabled }) => (
    <button
        type="button"
        onClick={() => enabled && setSearchSource(source)}
        disabled={!enabled}
        className={`flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors
            ${searchSource === source ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
            ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
    >
        {icon}
        {label}
    </button>
  );

  return (
    <div 
        className={`rounded-lg p-6 border transition-all duration-200 shadow-lg
            ${isDragging ? 'bg-gray-800/80 border-blue-500 ring-2 ring-blue-500/20' : 'bg-gray-800 border-gray-700'}
        `}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        tabIndex={0} // Allows div to capture paste events when focused/clicked
    >
       <div className="flex items-center gap-3 mb-2">
        <SearchIcon className="w-6 h-6 text-green-400" />
        <h2 className="text-xl font-semibold text-white">Test Search API</h2>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Ask a question or <span className="text-blue-400 font-semibold">Paste / Drag & Drop an image</span> to search your inventory.
        <br/>
        <span className="text-xs text-gray-500">Supports multilingual queries (Arabic, English, French, etc).</span>
      </p>

      <form onSubmit={handleSearch}>
        <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-gray-400">Search in:</span>
            <SourceButton source="ALL" label="All Sources" icon={<>🗂️</>} enabled={hasDataSource} />
            <SourceButton source="GOOGLE_DRIVE" label="Google Drive" icon={<DriveIcon className="w-4 h-4" />} enabled={hasGoogleDrive} />
        </div>

        {selectedImage && (
            <div className="mb-4 relative w-48 h-48 border-2 border-dashed border-gray-600 rounded-lg p-2 bg-gray-900/50 group">
                <img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} alt="Search preview" className="w-full h-full object-contain rounded-md" />
                <button
                    type="button"
                    onClick={() => {
                        setSelectedImage(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="absolute top-2 right-2 bg-black/60 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center transition-colors"
                    title="Remove image"
                >
                    &times;
                </button>
            </div>
        )}

        {isDragging && (
             <div className="mb-4 p-8 border-2 border-dashed border-blue-400 bg-blue-500/10 rounded-lg text-center">
                 <p className="text-blue-300 font-bold animate-pulse">Drop image to attach</p>
             </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
             <input
                type="text"
                dir="auto"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={hasDataSource ? `Ask a question (e.g., "Is this in stock?")` : "Please connect a data source first."}
                className="flex-grow bg-gray-700 text-white rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                disabled={isLoading || !hasDataSource}
            />
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} className="hidden" id="image-upload" />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed whitespace-nowrap"
                disabled={isLoading || !hasDataSource}
                title="Upload Image"
            >
                <ImageIcon className="w-5 h-5 mr-2" />
                {selectedImage ? 'Change' : 'Add Image'}
            </button>
             <button type="submit" className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed min-w-[120px]" disabled={!canSearch}>
                {isLoading ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Searching...</span>
                    </>
                ) : 'Search'}
            </button>
        </div>
      </form>

      {(isLoading || result) && (
        <div className="bg-gray-900/50 p-4 rounded-md mt-4 border border-gray-700 animate-in fade-in slide-in-from-top-2">
            {isLoading && (
                 <div className="flex items-center gap-3 text-gray-400">
                     <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                    </span>
                    <p className="text-sm">Analyzing request...</p>
                 </div>
            )}
            {result && (
                <div className="text-gray-300 whitespace-pre-wrap prose prose-invert prose-sm max-w-none" dir="auto">
                    <p>{result}</p>
                </div>
            )}
        </div>
      )}
    </div>
  );
};

export default SearchInterface;
