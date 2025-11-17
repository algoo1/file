import { FileObject, Client } from '../types.ts';
import { summarizeMultipleContents } from './geminiService.ts';

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
   * Wipes and re-indexes all files for a given client using a batch summarization process.
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
    
    console.log(`Starting batch sync for client ${client.name}. Wiping old index.`);
    await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay for wipe

    // Call the new batch summarization function once for all files.
    const summaryMap = await summarizeMultipleContents(filesFromDrive, fileSearchApiKey);
    
    // Map the results from the summary map back to the file objects.
    const processedFiles: FileObject[] = filesFromDrive.map(driveFile => {
        const result = summaryMap.get(driveFile.id);
        
        if (result && result.summary && !result.error) {
            return {
                ...driveFile,
                summary: result.summary,
                status: 'COMPLETED',
                statusMessage: 'Successfully indexed.',
            };
        } else {
            const errorMessage = result?.error || 'An unknown error occurred during indexing.';
            console.error(`Failed to summarize ${driveFile.name}: ${errorMessage}`);
            return {
                ...driveFile,
                summary: '',
                status: 'FAILED',
                statusMessage: errorMessage,
            };
        }
    });

    // Update the mock index with successfully processed files
    const successfullyProcessed = processedFiles
        .filter(f => f.status === 'COMPLETED')
        .map(({id, name, summary}) => ({id, name, summary}));

    fileSearchIndex[client.id] = { files: successfullyProcessed };
    
    console.log(`Sync complete for client ${client.name}. Processed ${processedFiles.length} files.`);
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