
/**
 * Summarizes the content of a document to make it searchable.
 * @param content The text content of the file.
 * @returns A promise that resolves to a summary of the content.
 */
export async function summarizeContent(content: string): Promise<string> {
  // Dynamically import the library only when it's needed to avoid startup crashes.
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const prompt = `Summarize the following document content to create a searchable index. Focus on key entities, topics, main points, and any structured data present. The summary should be concise yet comprehensive.

    Document Content:
    ---
    ${content}
    ---
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
