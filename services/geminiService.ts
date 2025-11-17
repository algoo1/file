
import { GoogleGenAI } from "@google/genai";

/**
 * Summarizes the content of a document to make it searchable.
 * @param content The text content of the file.
 * @param apiKey The Google AI API key to use for the request.
 * @returns A promise that resolves to a summary of the content.
 */
export async function summarizeContent(content: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new Error("A valid API key is required to summarize content with Gemini.");
  }
  // Dynamically import the library only when it's needed to avoid startup crashes.
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  try {
    const prompt = `Analyze the following document content and generate a structured summary for a search index. Your goal is to extract key information that a user might search for.

    Follow these instructions:
    1.  **Main Topic:** Briefly state the main purpose or topic of the document.
    2.  **Key Entities:** List important names, places, organizations, products, or technical terms.
    3.  **Core Concepts:** Summarize the main ideas, arguments, or processes described.
    4.  **Actionable Information:** Extract any specific instructions, contact details (emails, phone numbers), dates, or important numbers.

    Present the output clearly.

    Document Content:
    ---
    ${content.substring(0, 500000)}
    ---
    Structured Summary:
    `;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Error summarizing content:", error);
    throw new Error("Failed to index content with Gemini.");
  }
}
