import { FileObject, Client } from '../types.ts';
import { summarizeContent } from './geminiService.ts';

// Mock database for the external File Search service
const fileSearchIndex: Record<string, { files: Pick<FileObject, 'id' | 'name' | 'summary'>[] }> = {};

export const fileSearchService = {
  /**
   * Validates an API key.
   * @param apiKey The API key to validate.
   */
  validateApiKey: async (apiKey: string): Promise<boolean> => {
    console.log(`Validating File Search API Key: ${apiKey ? 'present' : 'missing'}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    // Simple validation for mock: key must not be empty
    const isValid = !!apiKey.trim();
    console.log(`API Key is ${isValid ? 'valid' : 'invalid'}`);
    return isValid;
  },

  /**
   * Wipes and re-indexes all files for a given client.
   * This is the "delete all and re-upload" logic.
   * @param client The client object.
   * @param filesFromDrive The latest list of files from Google Drive.
   * @param fileSearchApiKey The user's API key for this service.
   * @returns The updated list of indexed files.
   */
  syncClientFiles: async (
    client: Client, 
    filesFromDrive: Omit<FileObject, 'summary' | 'status'>[],
    fileSearchApiKey: string
  ): Promise<FileObject[]> => {
    if (!(await fileSearchService.validateApiKey(fileSearchApiKey))) {
        throw new Error("Invalid File Search API Key.");
    }
    
    console.log(`Starting sync for client ${client.name}. Wiping old index.`);
    // In a real API: POST /sync { clientId, files... }
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay for wipe + upload
    
    // Process and summarize each file before "uploading"
    const processedFiles: FileObject[] = await Promise.all(filesFromDrive.map(async (driveFile) => {
        try {
            // CRITICAL FIX: Pass the API key to the summarization service.
            const summary = await summarizeContent(driveFile.content, fileSearchApiKey);
            return { ...driveFile, summary, status: 'COMPLETED' };
        } catch (e) {
            console.error(`Failed to summarize ${driveFile.name}`, e);
            return { ...driveFile, summary: '', status: 'FAILED' };
        }
    }));
    
    // Update the mock index
    fileSearchIndex[client.id] = { files: processedFiles.map(({id, name, summary}) => ({id, name, summary})) };
    console.log(`Sync complete for client ${client.name}. Indexed ${processedFiles.length} files.`);
    console.log("Current Index State:", fileSearchIndex);
    
    return processedFiles;
  },

  /**
   * Queries the indexed data for a specific client.
   * @param client The client object.
   * @param query The user's search query.
   * @param fileSearchApiKey The user's API key for this service.
   */
  query: async (client: Client, query: string, fileSearchApiKey: string): Promise<string> => {
    try {
        if (!(await fileSearchService.validateApiKey(fileSearchApiKey))) {
            return "Error: Invalid File Search API Key.";
        }

        console.log(`Querying data for client ${client.name} with query: "${query}"`);
        // In a real API: POST /query { clientId, query }
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate network delay

        const clientIndex = fileSearchIndex[client.id];
        if (!clientIndex || clientIndex.files.length === 0) {
            return "There is no data indexed for this client. Please check the Google Drive sync.";
        }

        // The context is built from the *indexed* summaries.
        const context = clientIndex.files.map(f => `File: ${f.name}\n${f.summary}`).join('\n\n---\n\n');
        
        // Safeguard: Truncate context to avoid exceeding model token limits.
        const MAX_CONTEXT_LENGTH = 800000;
        let truncatedContext = context;
        if (truncatedContext.length > MAX_CONTEXT_LENGTH) {
            console.warn(`Context length is very large (${truncatedContext.length} chars). Truncating to ${MAX_CONTEXT_LENGTH} chars.`);
            truncatedContext = truncatedContext.substring(0, MAX_CONTEXT_LENGTH);
        }
        
        const prompt = `You are an intelligent search assistant. Your task is to provide a helpful and accurate answer to the user's query based *exclusively* on the provided context from indexed files.

- Analyze the user's query to understand their intent.
- Scrutinize the provided "Indexed Information" to find the most relevant passages.
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
        
        // Dynamically import the library only when it's needed to avoid startup crashes.
        const { GoogleGenAI } = await import("@google/genai");
        // CRITICAL FIX: Use the fileSearchApiKey provided by the user from settings.
        const ai = new GoogleGenAI({ apiKey: fileSearchApiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Standardize on flash model for consistency and robustness
            contents: prompt,
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
