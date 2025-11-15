
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
    console.log(`Validating File Search API Key: ${apiKey}`);
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
            const summary = await summarizeContent(driveFile.content);
            return { ...driveFile, summary, status: 'indexed' };
        } catch (e) {
            console.error(`Failed to summarize ${driveFile.name}`, e);
            return { ...driveFile, summary: '', status: 'error' };
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

    // This part still uses Gemini, but it simulates the backend of the File Search service doing it.
    // The context is built from the *indexed* summaries.
    const context = clientIndex.files.map(f => `File: ${f.name}\n${f.summary}`).join('\n\n---\n\n');
    
    // Re-using the geminiService function here simulates the backend logic
    const prompt = `You are a search API. Answer the user's query based ONLY on the provided indexed information. If the answer is not in the information, say "I cannot find an answer in the provided documents."

    Indexed Information:
    ---
    ${context}
    ---

    User Query: "${query}"
    `;
    
    // Dynamically import the library only when it's needed to avoid startup crashes.
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
    });
    return response.text;
  }
};
