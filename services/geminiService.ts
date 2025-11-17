

import { GoogleGenAI } from "@google/genai";
import { FileObject } from '../types.ts';

/**
 * Summarizes the content of a single document to make it searchable.
 * Implements a retry mechanism with exponential backoff to handle transient API errors like '503 Model Overloaded'.
 * @param file The file object to be summarized.
 * @param apiKey The Google AI API key to use for the request.
 * @returns A promise that resolves to an object containing the summary or an error message.
 */
export async function summarizeSingleContent(
  file: Omit<FileObject, 'summary' | 'status' | 'statusMessage' | 'type'>,
  apiKey: string
): Promise<{ summary: string; error?: string }> {
  if (!apiKey) {
    throw new Error("A valid API key is required to summarize content with Gemini.");
  }
  if (!file.content) {
    return { summary: '', error: 'Could not summarize: Document is empty or content could not be read.' };
  }

  // Dynamically import to avoid startup errors if the script isn't loaded yet.
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  
  // Truncate content to a safe limit for the model prompt
  const MAX_CONTENT_LENGTH = 800000;
  const truncatedContent = file.content.substring(0, MAX_CONTENT_LENGTH);

  const prompt = `You are an expert document analysis AI. I will provide you with a document. Your goal is to generate a structured summary for a search index.

Follow these instructions:
1.  **Main Topic:** Briefly state the main purpose or topic of the document.
2.  **Key Entities:** List important names, places, organizations, technical terms, etc.
3.  **Core Concepts:** Summarize the main ideas, arguments, or data points.
4.  **Actionable Information:** Extract any specific instructions, contact details, dates, or important numbers.

Base your summary *only* on the provided content.

Document Name: ${file.name}
Content:
---
${truncatedContent}
---
`;

  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 1000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const summary = response.text;
      if (!summary) {
        throw new Error("Model returned an empty summary.");
      }
      
      return { summary }; // Success, exit the loop and return the result.

    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed for summarizing "${file.name}".`, error);

      if (attempt === MAX_RETRIES - 1) {
        console.error(`Max retries reached for "${file.name}". Failing this file.`, error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown API error occurred.';
        return { summary: '', error: `Failed to summarize after ${MAX_RETRIES} attempts: ${errorMessage}` };
      }

      // Implement exponential backoff with jitter
      const delay = (INITIAL_BACKOFF_MS * Math.pow(2, attempt)) + (Math.random() * 1000);
      console.log(`Waiting for ${delay.toFixed(0)}ms before retrying "${file.name}"...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }

  // This part should not be reachable due to the return/throw in the loop, but as a fallback:
  return { summary: '', error: `Summarization failed for an unknown reason after ${MAX_RETRIES} retries.` };
}
