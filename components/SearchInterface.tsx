

import React, { useState, useCallback, useRef } from 'react';
import { Client } from '../types.ts';
import { SearchIcon } from './icons/SearchIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';

interface SearchInterfaceProps {
  client: Client;
  onSearch: (query: string, image?: { data: string; mimeType: string }) => Promise<string>;
}

const SearchInterface: React.FC<SearchInterfaceProps> = ({ client, onSearch }) => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
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
      const response = await onSearch(query, selectedImage);
      setResult(response);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "An error occurred while searching. Please try again.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [onSearch, query, selectedImage]);
  
  const hasSearchableContent = query.trim() || selectedImage;

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 shadow-lg">
       <div className="flex items-center gap-3 mb-2">
        <SearchIcon className="w-6 h-6 text-green-400" />
        <h2 className="text-xl font-semibold text-white">Test Search API</h2>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Use this form to test the search functionality. You can ask a question, upload an image, or both to query the indexed data from the Google Drive files.
      </p>

      <form onSubmit={handleSearch}>
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
                placeholder={`Ask a question about ${client.name}'s data...`}
                className="flex-grow bg-gray-700 text-white rounded-md px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                disabled={isLoading || !client.googleDriveFolderUrl}
            />
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} className="hidden" id="image-upload" />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                disabled={isLoading || !client.googleDriveFolderUrl}
            >
                <ImageIcon className="w-5 h-5 mr-2" />
                {selectedImage ? 'Change Image' : 'Add Image'}
            </button>
             <button type="submit" className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md flex items-center justify-center transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed min-w-[120px]" disabled={isLoading || !hasSearchableContent || !client.googleDriveFolderUrl}>
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