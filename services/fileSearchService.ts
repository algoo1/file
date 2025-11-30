
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { FileObject, Client, SyncedFile } from '../types.ts';
import { summarizeSingleContent } from './geminiService.ts';
import { databaseService } from './databaseService.ts';

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
    await new Promise(resolve => setTimeout(resolve, 100)); // Faster simulation
    const isValid = !!apiKey.trim();
    if (!isValid) console.warn(`API Key is invalid`);
    return isValid;
  },

  /**
   * @deprecated Search is now stateless/DB-backed. No local index to clear.
   */
  clearIndexForClient: async (clientId: string): Promise<void> => {
    // No-op
  },

  /**
   * @deprecated Search is now stateless/DB-backed. No local index to remove from.
   */
  removeFile: (clientId: string, fileId: string) => {
    // No-op
  },
  
  /**
   * Checks if a file exists in the index.
   * Now proxies to DB check (conceptually), but for "Smart Sync" optimization,
   * we assume if it's in the DB list passed to apiService, it's fine.
   * This is mostly legacy for the previous MiniSearch implementation.
   */
  hasFile: (clientId: string, fileId: string) => {
      return false; // Force re-check or just rely on DB state
  },

  /**
   * @deprecated Search is now stateless/DB-backed.
   */
  restoreIndex: async (clientId: string, file: SyncedFile): Promise<void> => {
      // No-op
  },
  
  /**
   * Processes a single file to generate its AI summary.
   * It no longer adds it to a local index, as the result is stored in the DB.
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
      statusMessage: result.error || 'Successfully processed.',
    };
    
    // We return the object. The API service will save `summary` to Supabase.
    // Supabase is then queried via `search_knowledge_base`.

    return processedFile;
  },


  /**
   * Queries the data using Agentic RAG (Gemini Function Calling).
   * 1. The user query is sent to Gemini with a 'search_knowledge_base' tool.
   * 2. Gemini decides if it needs to search.
   * 3. If called, we execute the search against the SUPABASE DATABASE.
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
        
        const ai = new GoogleGenAI({ apiKey: fileSearchApiKey });
        
        // Use 'chats' to maintain history for the multi-turn tool interaction
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                tools: [{ functionDeclarations: [searchToolDeclaration] }],
                systemInstruction: `You are an intelligent multilingual assistant for a private knowledge base (Product Inventory).

**CORE RESPONSIBILITIES:**

1.  **Image-Based Product Search (High Priority):**
    -   **Context:** The database contains Google Sheets (Product Data) and an 'images' folder containing Product Images.
    -   **Linking:** The Google Sheet often contains a column (e.g., "Image Link", "Photo") that references the images in the 'images' folder.
    -   **Scenario:** The user uploads an image and asks about it (e.g., "Price?", "Available?").
    -   **Action:** 
        1.  Analyze the **visual content** of the uploaded image (e.g., "Black Leather Handbag").
        2.  Call \`search_knowledge_base\` with queries to find the corresponding row in the Google Sheet.
        3.  **Cross-Verification:** If you find a text record, check if it logically matches the image.
    
    -   **Availability Determination (STRICT):**
        -   **AVAILABLE:** If a matching record is found in the Sheet, providing its price and details, you must state: **"The product is available."** (in user's language).
        -   **UNAVAILABLE:** If NO matching record is found, or the search yields no results for the visual description, you **MUST** state: **"This item is unavailable and not in stock."** (Translate to user language).
        -   **Ambiguity:** Do not guess. If unsure, lean towards unavailable.

2.  **General Search:** Use the tool for all fact-based queries.
3.  **Multilingual:** Answer in the user's language.
`
            }
        });

        // Prepare the initial message parts
        const messageParts: Part[] = [];
        
        // If query is empty but image exists, provide a default prompt to trigger the analysis
        if (!query.trim() && image) {
            messageParts.push({ text: "Analyze this image. If it's a product, search the database to check if it is in stock and what the price is." });
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

            // Execute Search directly against the Database
            let searchResults = await databaseService.searchFiles(client.id, searchQuery);

            // Filter by source if required
            if (source === 'GOOGLE_DRIVE') {
                searchResults = searchResults.filter(r => r.source === source);
            }

            // Prepare Tool Response
            let toolResultContent = "";
            if (searchResults.length > 0) {
                // Return matches to Gemini
                toolResultContent = searchResults
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
