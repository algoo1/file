import { FileObject, Client } from '../types.ts';
import { summarizeSingleContent } from './geminiService.ts';
import MiniSearch from 'minisearch';

// In-memory store for MiniSearch instances, one for each client.
const clientSearchIndexes: Record<string, MiniSearch> = {};

/**
 * Initializes or retrieves a MiniSearch instance for a client.
 * @param clientId The ID of the client.
 * @returns A MiniSearch instance.
 */
const getClientIndex = (clientId: string) => {
    if (!clientSearchIndexes[clientId]) {
        clientSearchIndexes[clientId] = new MiniSearch({
            fields: ['name', 'summary'], // fields to index for full-text search
            storeFields: ['name', 'summary', 'source'], // fields to return with search results
            searchOptions: {
                prefix: true, // support "prefix search" (e.g., "star" matches "starry")
                fuzzy: 0.2,   // allow for some typos
            }
        });
    }
    return clientSearchIndexes[clientId];
};

/**
 * Adds or updates a file in the client's MiniSearch index.
 * @param clientId The ID of the client.
 * @param file The file object containing the data to index.
 */
const addOrUpdateFileInIndex = (clientId: string, file: Pick<FileObject, 'id' | 'name' | 'summary' | 'source'>) => {
    const index = getClientIndex(clientId);
    // Use a Map-like interface for documents, with `id` being the unique identifier.
    if (index.has(file.id)) {
        index.replace(file);
    } else {
        index.add(file);
    }
    console.log(`Indexed file "${file.name}" from ${file.source} for client ${clientId}. Index now contains ${index.documentCount} documents.`);
};

export const fileSearchService = {
  /**
   * Validates an API key.
   */
  validateApiKey: async (apiKey: string): Promise<boolean> => {
    console.log(`Validating File Search API Key: ${apiKey ? 'present' : 'missing'}`);
    await new Promise(resolve => setTimeout(resolve, 100)); // Faster simulation
    const isValid = !!apiKey.trim();
    if (!isValid) console.warn(`API Key is invalid`);
    return isValid;
  },

  /**
   * Wipes the search index for a given client.
   * @param clientId The ID of the client whose index should be cleared.
   */
  clearIndexForClient: async (clientId: string): Promise<void> => {
    if (clientSearchIndexes[clientId]) {
        // Re-initialize the MiniSearch instance to clear it.
        delete clientSearchIndexes[clientId];
        console.log(`Cleared search index for client ${clientId}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async
  },
  
  /**
   * Processes a single file, summarizes it, and adds it to the local search index.
   * @param client The client object.
   * @param file The file data from Drive, including its content.
   * @param fileSearchApiKey The user's API key for Gemini.
   * @returns The fully processed file object.
   */
  indexSingleFile: async (
    client: Client,
    file: Omit<FileObject, 'summary' | 'status' | 'statusMessage'>,
    fileSearchApiKey: string
  ): Promise<FileObject> => {
      
    const result = await summarizeSingleContent(file, fileSearchApiKey);

    const processedFile: FileObject = {
      ...file,
      summary: result.summary || '',
      status: result.error ? 'FAILED' : 'COMPLETED',
      statusMessage: result.error || 'Successfully indexed.',
    };
    
    // Only add successfully processed files to the local search index.
    if (processedFile.status === 'COMPLETED') {
        addOrUpdateFileInIndex(client.id, processedFile);
    }

    return processedFile;
  },


  /**
   * Queries the data using a cost-effective two-step process.
   * 1. Performs a fast, local search to find the most relevant files.
   * 2. Sends only the top results to the AI for a final, synthesized answer.
   */
  query: async (
    client: Client,
    query: string,
    fileSearchApiKey: string,
    source: 'ALL' | 'GOOGLE_DRIVE' | 'AIRTABLE',
    image?: { data: string; mimeType: string }
  ): Promise<string> => {
    try {
        if (!(await fileSearchService.validateApiKey(fileSearchApiKey))) {
            return "Error: Invalid File Search API Key.";
        }
        
        const localIndex = getClientIndex(client.id);
        if (localIndex.documentCount === 0) {
            return "There is no data indexed for this client. Please sync a data source first.";
        }

        // STEP 1: Fast local search to pre-filter relevant documents.
        let searchResults;
        if (query.trim()) {
            searchResults = localIndex.search(query, {
                fields: ['name', 'summary'],
                combineWith: 'AND',
            });
        } else {
            // If it's an image-only query, we take all documents for context.
            // FIX: MiniSearch does not have a public API to get all documents.
            // Accessing the internal `_documents` map is a workaround.
            searchResults = Array.from((localIndex as any)._documents.values());
        }
        
        // Filter by the selected data source.
        const filteredBySource = source === 'ALL' 
            ? searchResults 
            : searchResults.filter(r => r.source === source);

        // Take the top 5 most relevant results from the filtered list.
        const relevantFiles = filteredBySource.slice(0, 5);
        
        if (relevantFiles.length === 0) {
             return `I could not find any relevant documents for your query in the selected source (${source.replace('_', ' ')}).`;
        }

        const context = relevantFiles
            .map(f => `Source: ${f.source}\nFile: ${f.name}\n${f.summary}`)
            .join('\n\n---\n\n');
        
        // STEP 2: Call the AI with a much smaller, more relevant context.
        const promptText = `You are an intelligent search assistant. Your task is to provide a helpful and accurate answer to the user's query based *exclusively* on the provided context from a pre-filtered list of relevant files and the user-provided image if available.

- Analyze the user's query and image (if provided) to understand their intent.
- Scrutinize the provided "Relevant Information" to synthesize an answer.
- If an image is provided, use it as the primary subject of the query. Find information about what is depicted in the image from the indexed text.
- Synthesize an answer directly from the information found.
- If the information is not available in the context, you MUST respond with: "I could not find an answer to your question in the available documents."
- Do not use any external knowledge.

Relevant Information:
---
${context}
---

User Query: "${query}"

Answer:
`;

        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: fileSearchApiKey });
        
        const parts: any[] = [{ text: promptText }];
        if (image) {
            parts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data,
                },
            });
        }
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: parts },
        });

        return response.text;
    } catch (error) {
        console.error("Error during query:", error);
        if (error instanceof Error && error.message.includes("API key")) {
            return "Error: The provided File Search Service API Key is invalid or missing permissions for the Gemini API.";
        }
        return "An unexpected error occurred while querying the data.";
    }
  }
};