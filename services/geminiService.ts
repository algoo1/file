
import { GoogleGenAI } from "@google/genai";
import { FileObject } from '../types.ts';

/**
 * Summarizes the content of a single document or describes an image to make it searchable.
 * Implements a robust retry mechanism that respects Google's requested retry delays.
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

  // Use the top-level imported class
  const ai = new GoogleGenAI({ apiKey });
  
  let contents: any;

  // --- STRATEGY 1: IMAGE PROCESSING ---
  if (file.type === 'image') {
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
  // --- STRATEGY 2: GOOGLE SHEET / CSV PROCESSING ---
  else if (file.type === 'sheet') {
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
    *   List the products found in the sheet.
    *   For every key product, provide a structured summary in the following format:
        *   **Product:** [Name]
        *   **Price:** [Price]
        *   **Details:** [Key description points]
        *   **Image Reference:** [URL or filename if found]

3.  **Multilingual Indexing:**
    *   Translate the *categories* and *product types* into **Arabic, English, French, and Spanish** and list them at the bottom as tags.

**Input CSV Data:**
\`\`\`csv
${file.content}
\`\`\`
`;
      contents = prompt;
  }
  // --- STRATEGY 3: GENERAL DOCUMENTS ---
  else {
    const MAX_CONTENT_LENGTH = 300000;
    const truncatedContent = file.content.substring(0, MAX_CONTENT_LENGTH);
    const prompt = `You are an expert data analysis AI. I will provide you with content from a file or document. Your goal is to generate a structured summary for a **multilingual** search index.

Follow these instructions:
1.  **Main Topic:** Briefly state the main purpose or topic of the content.
2.  **Key Entities:** List important names, places, organizations, product codes.
3.  **Core Concepts:** Summarize the main ideas.
4.  **Multilingual Keywords (CRITICAL):** 
    *   Identify the top 20 most important keywords.
    *   **Translate** these specific keywords into the following languages: **Arabic, English, French, German, Spanish, Portuguese, Chinese (Simplified), Japanese, Russian, and Hindi**.

File Name: ${file.name}
Content:
---
${truncatedContent}
---
`;
    contents = prompt;
  }

  // --- ROBUST RETRY LOGIC ---
  const MAX_RATE_LIMIT_RETRIES = 5;
  const MAX_GENERIC_RETRIES = 3;
  
  let rateLimitAttempts = 0;
  let genericAttempts = 0;

  while (true) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
      });

      const summary = response.text;
      if (!summary) throw new Error("Model returned empty summary.");
      
      return { summary }; // Success!

    } catch (error: any) {
      const errMessage = error.message || JSON.stringify(error);
      const isRateLimit = errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED') || errMessage.includes('Quota');

      // 1. Handle Rate Limits (429) - Be Patient
      if (isRateLimit) {
          rateLimitAttempts++;
          if (rateLimitAttempts > MAX_RATE_LIMIT_RETRIES) {
               return { summary: '', error: `Rate limit exceeded. Failed after ${rateLimitAttempts} waits. Please try again later.` };
          }

          // Default wait
          let waitTime = 20000; 

          // Try to extract exact wait time from Google's error message
          // Example: "Please retry in 22.740650754s"
          const match = errMessage.match(/retry in\s+([0-9.]+)\s*s/);
          if (match && match[1]) {
             // Parse seconds, convert to ms, add 2 seconds buffer
             waitTime = Math.ceil(parseFloat(match[1]) * 1000) + 2000;
          }

          console.warn(`[Gemini] Rate limit hit for "${file.name}". Waiting ${waitTime/1000}s before retry #${rateLimitAttempts}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Loop again
      }

      // 2. Handle Other Errors (400, 500) - Fail Fast
      genericAttempts++;
      console.error(`[Gemini] Error processing "${file.name}" (Attempt ${genericAttempts}):`, errMessage);

      if (genericAttempts >= MAX_GENERIC_RETRIES) {
          return { summary: '', error: `Processing failed: ${errMessage}` };
      }

      // Short backoff for generic errors
      await new Promise(resolve => setTimeout(resolve, 2000 * genericAttempts));
    }
  }
}
