
import { GoogleGenAI, Type } from "@google/genai";
import { FileObject } from '../types.ts';

/**
 * Summarizes the content of multiple documents in a single batch request to make them searchable.
 * @param files The file objects to be summarized.
 * @param apiKey The Google AI API key to use for the request.
 * @returns A promise that resolves to a Map where keys are file IDs and values are the summarization results.
 */
export async function summarizeMultipleContents(
  files: Omit<FileObject, 'summary' | 'status' | 'statusMessage' | 'type'>[],
  apiKey: string
): Promise<Map<string, { summary: string; error?: string }>> {
  if (!apiKey) {
    throw new Error("A valid API key is required to summarize content with Gemini.");
  }
  if (files.length === 0) {
    return new Map();
  }

  // Dynamically import to avoid startup errors if the script isn't loaded yet.
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  // Construct a single prompt containing all file contents.
  const filesContext = files.map(file =>
    `--- DOCUMENT START ---\n` +
    `ID: ${file.id}\n` +
    `Name: ${file.name}\n` +
    `Content:\n${file.content.substring(0, 150000)}\n` + // Truncate individual files to be safe
    `--- DOCUMENT END ---\n`
  ).join('\n');

  // A safeguard against excessively large prompts.
  const MAX_PROMPT_LENGTH = 900000;
  if (filesContext.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Combined content of ${files.length} files is too large to process in a single batch. Please sync fewer files at a time.`);
  }

  const prompt = `You are an expert document analysis AI. I will provide you with a batch of documents. For each document, you must generate a structured summary for a search index.

Your goal is to extract key information that a user might search for. Follow these instructions for EACH document:
1.  **Main Topic:** Briefly state the main purpose or topic.
2.  **Key Entities:** List important names, places, organizations, etc.
3.  **Core Concepts:** Summarize the main ideas or arguments.
4.  **Actionable Information:** Extract any specific instructions, contact details, dates, or important numbers.

You MUST return a JSON array where each object represents a document and has the following structure: { "fileId": "...", "summary": "..." }.
If you cannot process a document for any reason (e.g., it's empty or garbled), you must still include its object in the array, but set the summary to a short error description, like "Could not summarize: Document is empty.".

Here are the documents:
${filesContext}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              fileId: {
                type: Type.STRING,
                description: 'The unique ID of the file being summarized.',
              },
              summary: {
                type: Type.STRING,
                description: 'The structured summary of the file content, or an error message.',
              },
            },
            required: ['fileId', 'summary'],
          },
        },
      },
    });

    const jsonText = response.text.trim();
    const summarizedResults: { fileId: string; summary: string }[] = JSON.parse(jsonText);

    // Convert array to a Map for efficient lookups.
    const summaryMap = new Map<string, { summary: string; error?: string }>();
    for (const result of summarizedResults) {
        if (result.summary.toLowerCase().startsWith("could not summarize")) {
             summaryMap.set(result.fileId, { summary: '', error: result.summary });
        } else {
             summaryMap.set(result.fileId, { summary: result.summary });
        }
    }
    
    // Final check to ensure the model didn't miss any files from the request.
    for (const file of files) {
        if (!summaryMap.has(file.id)) {
            summaryMap.set(file.id, { summary: '', error: 'Model did not return a summary for this file.' });
        }
    }

    return summaryMap;
  } catch (error) {
    console.error("Error summarizing content in batch:", error);
    // If the entire batch request fails, create a map indicating failure for all files.
    const errorMap = new Map<string, { summary: string; error?: string }>();
    const errorMessage = error instanceof Error ? error.message : "Batch summarization failed due to an API error.";
    files.forEach(file => {
        errorMap.set(file.id, { summary: '', error: errorMessage });
    });
    return errorMap;
  }
}
