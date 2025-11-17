import React, { useState, useCallback, useRef } from 'react';
import { Client } from '../types.ts';
import { SearchIcon } from './icons/SearchIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { AirtableIcon } from './icons/AirtableIcon.tsx';

type SearchSource = 'ALL' | 'GOOGLE_DRIVE' | 'AIRTABLE';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const hasAirtable = (!!client.airtable_api_key || !!client.airtable_access_token) && !!client.airtable_base_id && !!client.airtable_table_id;
  const hasDataSource = hasGoogleDrive || hasAirtable;
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
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 shadow-lg">
       <div className="flex items-center gap-3 mb-2">
        <SearchIcon className="w-6 h-6 text-green-400" />
        <h2 className="text-xl font-semibold text-white">Test Search API</h2>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Use this form to test the search functionality. You can ask a question, upload an image, or both to query the indexed data from all connected data sources.
      </p>

      <form onSubmit={handleSearch}>
        <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-gray-400">Search in:</span>
            <SourceButton source="ALL" label="All Sources" icon={<>🗂️</>} enabled={hasDataSource} />
            <SourceButton source="GOOGLE_DRIVE" label="Google Drive" icon={<DriveIcon className="w-4 h-4" />} enabled={hasGoogleDrive} />
            <SourceButton source="AIRTABLE" label="Airtable" icon={<AirtableIcon className="w-4 h-4" />} enabled={hasAirtable} />
        </div>

        {selectedImage && (
            <div className="mb-4 relative w-48 h-48 border-2 border-dashed border-gray-600 rounded-lg p-2">
                <img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} alt="Search preview" className="w-full h-full object-contain rounded-md" />
                <button
                    type="button"
                    onClick={() => {
                        setSelectedImage(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-black/80"
                    title="Remove image"
                >
                    &times;
                </button>
            </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
             <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={hasDataSource ? `Ask a question about ${client.name}'s data...` : "Please connect a data source first."}
                className="flex-grow bg-gray-700 text-white rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                disabled={isLoading || !hasDataSource}
            />
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} className="hidden" id="image-upload" />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                disabled={isLoading || !hasDataSource}
            >
                <ImageIcon className="w-5 h-5 mr-2" />
                {selectedImage ? 'Change Image' : 'Add Image'}
            </button>
             <button type="submit" className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed min-w-[120px]" disabled={!canSearch}>
                {isLoading ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
        <div className="bg-gray-900/50 p-4 rounded-md mt-4 border border-gray-700">
            {isLoading && <p className="text-gray-400">Searching...</p>}
            {result && (
                <div className="text-gray-300 whitespace-pre-wrap prose prose-invert prose-sm max-w-none">
                    <p>{result}</p>
                </div>
            )}
        </div>
      )}
    </div>
  );
};

export default SearchInterface;