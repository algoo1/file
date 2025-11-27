
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

  // --- STRATEGY 1: IMAGE PROCESSING ---
  if (file.type === 'image') {
    // Advanced multimodal prompt for structured data extraction and description with multilingual support
    const prompt = `You are an advanced AI assistant specializing in multimodal data extraction and analysis for a global search index. Your task is to process the provided image and generate a structured, text-based representation of its content.

**Image Name:** ${file.name}

**Instructions:**

1.  **Analyze Image Type:** Determine if it is a document, spreadsheet, receipt, label, diagram, or photograph.

2.  **Structured Data Extraction:**
    *   Transcribe visible text with high accuracy (OCR).
    *   Reconstruct tables in Markdown.
    *   Extract key-value pairs (e.g., Invoice #, Dates, Totals).

3.  **Visual Description:** Describe the scene, objects, colors, and key visual features.

4.  **Multilingual Search Keywords (CRITICAL):** 
    *   Identify the top 20 most important keywords, entities, and concepts from the image.
    *   **Translate** these keywords into the following languages: **Arabic, English, French, German, Spanish, Portuguese, Chinese (Simplified), Japanese, Russian, and Hindi**.
    *   List them clearly as a comma-separated list or a keyword block at the end of the summary. This allows users to search for this image using any of these languages.

**Output Format:**
- Use clear headings (e.g., "## Extracted Text", "## Visual Description", "## Multilingual Keywords").
`;
    
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
  } 
  // --- STRATEGY 2: GOOGLE SHEET / CSV PROCESSING (Specialized for Products) ---
  else if (file.type === 'sheet') {
      // We pass the raw CSV data. Gemini Flash has a huge context window, so it can handle large sheets.
      const prompt = `You are an expert **Product Inventory Manager** and Data Analyst. 
I have exported a Google Sheet containing product data into CSV format. Your job is to create a highly accurate, structured index of this data.

**File Name:** ${file.name}

**CORE OBJECTIVES:**
1.  **Column Mapping:** Analyze the CSV headers. Identify which columns correspond to:
    *   **Product Name** (e.g., Item, Title, Name)
    *   **Price** (e.g., Cost, MSRP, Value)
    *   **Description** (e.g., Details, Specs, Notes)
    *   **Image** (e.g., Image URL, Photo Link, Asset)
    *   **ID/SKU** (if present)

2.  **Data Extraction & Structuring:** 
    *   Do NOT just summarize the "vibe" of the file. 
    *   List the products found in the sheet.
    *   For every key product, provide a structured summary in the following format:
        *   **Product:** [Name]
        *   **Price:** [Price]
        *   **Details:** [Key description points]
        *   **Image Reference:** [URL or filename if found]

3.  **Foundation for Editing (Internal Thought):**
    *   Note the explicit column names found in the header. (e.g., "The Price column is labeled 'Retail_Price'"). This is crucial for future data modification tasks.

4.  **Multilingual Indexing:**
    *   Translate the *categories* and *product types* into **Arabic, English, French, and Spanish** and list them at the bottom as tags.

**Input CSV Data:**
\`\`\`csv
${file.content}
\`\`\`
`;
      contents = prompt;
  }
  // --- STRATEGY 3: GENERAL DOCUMENTS (PDFs, Text) ---
  else {
    const MAX_CONTENT_LENGTH = 800000;
    const truncatedContent = file.content.substring(0, MAX_CONTENT_LENGTH);
    const prompt = `You are an expert data analysis AI. I will provide you with content from a file or document. Your goal is to generate a structured summary for a **multilingual** search index.

Follow these instructions:
1.  **Main Topic:** Briefly state the main purpose or topic of the content (in the content's original language).
2.  **Key Entities:** List important names, places, organizations, product codes, technical terms, etc.
3.  **Core Concepts:** Summarize the main ideas, arguments, or data points.
4.  **Actionable Information:** Extract any specific instructions, contact details, dates, or important numbers.
5.  **Multilingual Keywords (CRITICAL):** 
    *   Identify the top 20 most important keywords, concepts, or entities from the content.
    *   **Translate** these specific keywords into the following languages: **Arabic, English, French, German, Spanish, Portuguese, Chinese (Simplified), Japanese, Russian, and Hindi**.
    *   Format them as a simple list or block of text. This section is strictly for the search engine to index, so ensure the translated terms are accurate.

Base your summary *only* on the provided content.

File Name: ${file.name}
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
