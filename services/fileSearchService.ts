

import { FileObject, Client } from '../types.ts';
import { summarizeSingleContent } from './geminiService.ts';

// Mock database for the external File Search service
// Using a Map for efficient per-file updates.
const fileSearchIndex: Record<string, { files: Map<string, Pick<FileObject, 'id' | 'name' | 'summary'>> }> = {};


const addOrUpdateFileInIndex = (clientId: string, file: Pick<FileObject, 'id' | 'name' | 'summary'>) => {
    if (!fileSearchIndex[clientId]) {
        fileSearchIndex[clientId] = { files: new Map() };
    }
    fileSearchIndex[clientId].files.set(file.id, file);
    console.log(`Indexed file "${file.name}" for client ${clientId}. Index size: ${fileSearchIndex[clientId].files.size}`);
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
   * Wipes the index for a given client. This is called at the start of a sync operation.
   * @param clientId The ID of the client whose index should be cleared.
   */
  clearIndexForClient: async (clientId: string): Promise<void> => {
    if (fileSearchIndex[clientId]) {
        delete fileSearchIndex[clientId];
        console.log(`Cleared search index for client ${clientId}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async
  },
  
  /**
   * Processes and indexes a single file. It summarizes the content and updates the search index.
   * @param client The client object.
   * @param file The file data from Drive, including its content.
   * @param fileSearchApiKey The user's API key for this service.
   * @returns The fully processed file object with its final status.
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
    
    // Only add successfully processed files to the live search index.
    if (processedFile.status === 'COMPLETED') {
        addOrUpdateFileInIndex(client.id, processedFile);
    }

    return processedFile;
  },


  /**
   * Queries the indexed data for a specific client, with optional image input.
   * @param client The client object.
   * @param query The user's text search query.
   * @param fileSearchApiKey The user's API key for this service.
   * @param image Optional image data for multimodal search.
   */
  query: async (
    client: Client,
    query: string,
    fileSearchApiKey: string,
    image?: { data: string; mimeType: string }
  ): Promise<string> => {
    try {
        if (!(await fileSearchService.validateApiKey(fileSearchApiKey))) {
            return "Error: Invalid File Search API Key.";
        }

        console.log(`Querying data for client ${client.name} with query: "${query}" and image: ${image ? 'present' : 'absent'}`);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate network delay

        const clientIndex = fileSearchIndex[client.id];
        if (!clientIndex || clientIndex.files.size === 0) {
            return "There is no data indexed for this client. Please check the Google Drive sync.";
        }
        
        const context = Array.from(clientIndex.files.values())
            .map(f => `File: ${f.name}\n${f.summary}`)
            .join('\n\n---\n\n');
        
        const MAX_CONTEXT_LENGTH = 800000;
        let truncatedContext = context;
        if (truncatedContext.length > MAX_CONTEXT_LENGTH) {
            console.warn(`Context length is very large (${truncatedContext.length} chars). Truncating to ${MAX_CONTEXT_LENGTH} chars.`);
            truncatedContext = truncatedContext.substring(0, MAX_CONTEXT_LENGTH);
        }
        
        const promptText = `You are an intelligent search assistant. Your task is to provide a helpful and accurate answer to the user's query based *exclusively* on the provided context from indexed files and the user-provided image if available.

- Analyze the user's query and image (if provided) to understand their intent.
- Scrutinize the provided "Indexed Information" to find the most relevant passages or file descriptions.
- If an image is provided, use it as the primary subject of the query. Find information about what is depicted in the image from the indexed text.
- Synthesize an answer directly from the information found.
- If the information is not available in the context, you MUST respond with: "I could not find an answer to your question in the available documents."
- Do not use any external knowledge.

Indexed Information:
---
${truncatedContext}
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