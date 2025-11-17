

import { GoogleGenAI } from "@google/genai";
import { FileObject } from '../types.ts';

/**
 * Parses a duration string from the Google API (e.g., "32s", "0.5s") into milliseconds.
 * @param delayString The duration string.
 * @returns The duration in milliseconds, or null if parsing fails.
 */
const parseRetryDelay = (delayString: string): number | null => {
  if (delayString && delayString.endsWith('s')) {
    const seconds = parseFloat(delayString.slice(0, -1));
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  return null;
};

/**
 * Summarizes the content of a single document or describes an image to make it searchable.
 * Implements a retry mechanism with exponential backoff and specific handling for 429 rate limit errors.
 * @param file The file object to be processed.
 * @param apiKey The Google AI API key to use for the request.
 * @returns A promise that resolves to an object containing the summary/description or an error message.
 */
export async function summarizeSingleContent(
  file: Omit<FileObject, 'summary' | 'status' | 'statusMessage'>,
  apiKey: string
): Promise<{ summary: string; error?: string }> {
  if (!apiKey) {
    throw new Error("A valid API key is required to summarize content with Gemini.");
  }
  if (!file.content) {
    return { summary: '', error: 'Could not process: File is empty or content could not be read.' };
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  
  let contents: any;

  if (file.type === 'image') {
    // Multimodal prompt for image description
    const prompt = `You are an expert image analysis AI. Your goal is to generate a detailed, structured description of the following image for a search index.

Follow these instructions:
1.  **Main Subject:** Clearly identify the primary subject(s) of the image.
2.  **Objects & Environment:** List all significant objects, items, and describe the surrounding environment.
3.  **Text Content:** Transcribe any visible text, numbers, or labels accurately.
4.  **Key Attributes:** Note colors, shapes, textures, and other visual details.
5.  **Inferred Context:** Briefly infer the purpose, context, or category of the image (e.g., "product photo", "document screenshot", "architectural diagram").

Base your description *only* on the provided image.

Image Name: ${file.name}`;
    
    contents = {
        parts: [
            { text: prompt },
            {
                inlineData: {
                    mimeType: file.mimeType,
                    data: file.content, // base64 string
                },
            },
        ],
    };
  } else {
    // Text-based summarization for PDFs, Sheets, etc.
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
    contents = prompt;
  }


  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 1000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
      });

      const summary = response.text;
      if (!summary) {
        throw new Error("Model returned an empty summary.");
      }
      
      return { summary }; // Success, exit the loop and return the result.

    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed for processing "${file.name}".`, error);

      if (attempt === MAX_RETRIES - 1) {
        console.error(`Max retries reached for "${file.name}". Failing this file.`, error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown API error occurred.';
        return { summary: '', error: `Failed to process after ${MAX_RETRIES} attempts: ${errorMessage}` };
      }

      // Default exponential backoff
      let delay = (INITIAL_BACKOFF_MS * Math.pow(2, attempt)) + (Math.random() * 1000); 
      
      // Smart retry for 429 Rate Limit errors
      if (error instanceof Error) {
        try {
          // The SDK often stringifies the actual API error object in the message property.
          const errorDetails = JSON.parse(error.message);
          if (errorDetails.error?.code === 429 && errorDetails.error?.details) {
            const retryInfo = errorDetails.error.details.find(
              (d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
            );
            
            if (retryInfo?.retryDelay) {
              const parsedDelay = parseRetryDelay(retryInfo.retryDelay);
              if (parsedDelay) {
                delay = parsedDelay + (Math.random() * 500); // Add jitter to avoid thundering herd
                console.log(`Rate limit exceeded. API suggested retrying in ${retryInfo.retryDelay}. Waiting for ${delay.toFixed(0)}ms.`);
              }
            }
          }
        } catch (e) {
          // Not a parsable JSON error message, proceed with the default backoff.
          console.log("Could not parse specific retry delay from error. Using default backoff.");
        }
      }

      console.log(`Waiting for ${delay.toFixed(0)}ms before retrying "${file.name}"...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }

  // This part should not be reachable due to the return/throw in the loop, but as a fallback:
  return { summary: '', error: `Processing failed for an unknown reason after ${MAX_RETRIES} retries.` };
}