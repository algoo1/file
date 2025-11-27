
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { FileObject, Client, SyncedFile } from '../types.ts';
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
                // Boost summary slightly as it contains the multilingual keywords
                boost: { summary: 2 } 
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

// --- Tool Definition for Gemini ---
const searchToolDeclaration: FunctionDeclaration = {
    name: 'search_knowledge_base',
    description: 'Search the internal database for documents, files, and records. Use this to find data that matches the user\'s text query or image input.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            search_query: {
                type: Type.STRING,
                description: 'The optimal keyword search query. If the user provides an image, extract specific details (Product IDs, Names, Dates, or Visual Descriptions) from the image to form this query.',
            },
        },
        required: ['search_query'],
    },
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
   * Restores a file to the search index using existing data from the database.
   * Does NOT call the AI service. This is used for "Smart Sync" when a file hasn't changed.
   */
  restoreIndex: async (clientId: string, file: SyncedFile): Promise<void> => {
      if (file.status === 'COMPLETED' && file.summary) {
          addOrUpdateFileInIndex(clientId, {
              id: file.source_item_id,
              name: file.name,
              summary: file.summary,
              source: file.source
          });
      }
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
   * Queries the data using Agentic RAG (Gemini Function Calling).
   * 1. The user query is sent to Gemini with a 'search_knowledge_base' tool.
   * 2. Gemini decides if it needs to search and what keywords to use (translating if needed).
   * 3. If called, we execute the local search and return results to Gemini.
   * 4. Gemini synthesizes the final answer.
   */
  query: async (
    client: Client,
    query: string,
    fileSearchApiKey: string,
    source: 'ALL' | 'GOOGLE_DRIVE',
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

        const ai = new GoogleGenAI({ apiKey: fileSearchApiKey });
        
        // Use 'chats' to maintain history for the multi-turn tool interaction
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                tools: [{ functionDeclarations: [searchToolDeclaration] }],
                systemInstruction: `You are an intelligent multilingual assistant for a private knowledge base.

**CORE RESPONSIBILITIES:**
1. **Search First:** Always use the 'search_knowledge_base' tool if the user asks for facts, data, or provides an image for comparison.
2. **Image Analysis (CRITICAL):** 
   - If the user uploads an image, **analyze the image first**. 
   - Extract text (OCR), product codes, names, or specific visual features.
   - Use these extracted details to formulate a specific 'search_query' for the database.
   - **Verification:** After the tool returns search results, COMPARE the uploaded image details against the text in the search results. Explicitly state if the image matches the records.
3. **Multilingual:** If the user asks in a language other than English (e.g., Arabic), translate the search query concepts to English for the tool, but answer the user in their original language.
4. **No Hallucinations:** If the tool returns no results, politely inform the user you couldn't find a matching record in the database.
`
            }
        });

        // Prepare the initial message parts
        const messageParts: Part[] = [];
        
        // If query is empty but image exists, provide a default prompt to trigger the analysis
        if (!query.trim() && image) {
            messageParts.push({ text: "Analyze this image and search the database for any matching records or relevant information." });
        } else {
            messageParts.push({ text: query });
        }

        if (image) {
            messageParts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data,
                },
            });
        }

        // Send message and wait for model response (text or tool call)
        let response = await chat.sendMessage({ message: messageParts });
        
        // Handle Function Calls (Agentic Loop)
        // We handle a single turn of tool use (Request -> Execute -> Response -> Final Answer)
        const functionCall = response.functionCalls?.[0];

        if (functionCall && functionCall.name === 'search_knowledge_base') {
            const searchQuery = (functionCall.args as any).search_query;
            console.log(`Gemini requested search for: "${searchQuery}"`);

            // Execute Local Search
            let searchResults = localIndex.search(searchQuery, {
                fields: ['name', 'summary'],
                combineWith: 'OR', // Robust 'OR' logic
                prefix: true,
                fuzzy: 0.2
            });

            // Filter by source if required
            if (source === 'GOOGLE_DRIVE') {
                searchResults = searchResults.filter(r => r.source === source);
            }

            // Prepare Tool Response
            let toolResultContent = "";
            if (searchResults.length > 0) {
                const topResults = searchResults.slice(0, 5); // Top 5
                toolResultContent = topResults
                    .map(f => `Source: ${f.source}\nFile: ${f.name}\nSummary/Keywords: ${f.summary}`)
                    .join('\n\n---\n\n');
            } else {
                toolResultContent = "No relevant documents found in the database for this query.";
            }

            // Send the tool output back to Gemini
            response = await chat.sendMessage({
                message: [{
                    functionResponse: {
                        name: 'search_knowledge_base',
                        response: { result: toolResultContent }
                    }
                }]
            });
        }

        return response.text || "No response generated.";

    } catch (error) {
        console.error("Error during query:", error);
        if (error instanceof Error && error.message.includes("API key")) {
            return "Error: The provided File Search Service API Key is invalid or missing permissions for the Gemini API.";
        }
        return `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
};
