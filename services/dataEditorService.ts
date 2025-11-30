
import { GoogleGenAI, Type } from "@google/genai";

interface EditPlan {
    explanation: string;
    updatedCsv: string;
    requiresConfirmation: boolean;
}

export const dataEditorService = {
    /**
     * Generates a plan to modify the CSV data based on a user's natural language request.
     * Supports multilingual inputs (Arabic, English, French, etc.) and complex logic.
     */
    generateEditPlan: async (
        originalCsv: string,
        userInstruction: string,
        apiKey: string,
        image?: { data: string; mimeType: string },
        uploadedImageUrl?: string
    ): Promise<EditPlan> => {
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `You are a highly intelligent, world-class Data Operations Agent. 
Your capability is to manipulate structured data (CSV) based on natural language instructions in **ANY language** (Arabic, English, French, Spanish, Chinese, etc.).

**CORE DIRECTIVES:**

1.  **Multilingual Intelligence:** 
    *   The user may speak in Arabic (e.g., "امسح الوصف"), English ("Clear the description"), French ("Effacer la description"), etc.
    *   The CSV headers might be in a completely different language than the user's command.
    *   **Task:** You must intelligently map the user's intent to the correct columns and rows, regardless of language mismatches. (e.g., If user says "Change Price" in English, but the column is labeled "السعر" or "Prix", you MUST identify and edit that column).

2.  **Precise Action Logic:**
    *   **"Add/Link Image":** If an image URL is provided in the prompt context, find the most relevant column (e.g., "Image", "Photo", "Asset", "Link", "Avatar") or **create a new column named "Image"** if none exists. Insert the URL into the specific row identified by the user.
    *   **"Delete/Remove Text/Cell":** If the user asks to remove specific *content* or a *value* (e.g., "remove the description", "delete the price"), **CLEAR that specific cell** (set to empty string). Do NOT delete the entire row unless explicitly asked.
    *   **"Delete/Remove Product/Row":** If the user asks to remove an entire *item*, *record*, or *entry* (e.g., "delete the iPhone row", "remove the item with ID 5"), **DELETE the entire row**.
    *   **"Update/Change":** Modify the specific value with high precision.

3.  **Visual Context Awareness:**
    *   If an image is attached for *analysis* (visual context), use it to identify the product in the CSV (e.g., user uploads a photo of red shoes and says "Change the price of this product"). You must match the visual description to the text data.

4.  **Strict Output Format:**
    *   You MUST return a JSON object.
    *   \`explanation\`: A clear, concise summary of exactly what you changed. **IMPORTANT: Write this explanation in the SAME language the user used in their instruction.**
    *   \`updatedCsv\`: The complete, valid, raw CSV string representing the new state of the file. Preserve all other data perfectly.
    *   \`requiresConfirmation\`: true if the request is destructive (deleting > 1 row) or highly ambiguous.

`;

        let prompt = `
**Current CSV Content:**
\`\`\`csv
${originalCsv}
\`\`\`

**User Request:** "${userInstruction}"
`;
        
        // Inject the specific logic for the uploaded file link
        if (uploadedImageUrl) {
            prompt += `\n**SYSTEM EVENT - IMAGE UPLOAD:** 
The user has uploaded an image to the cloud. 
**URL:** ${uploadedImageUrl}
**INSTRUCTION:** You MUST insert this URL into the appropriate Image/Photo column for the product identified in the User Request. If the request implies adding a NEW product, use this URL for its image.
`;
        }

        if (image) {
            prompt += `\n**(Note: An image has been provided as visual context. Use it to identify the product if the text description is vague.)**`;
        }

        prompt += `\nGenerate the JSON response.`;

        const parts: any[] = [{ text: prompt }];
        if (image) {
            parts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data
                }
            });
        }

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts },
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            explanation: { type: Type.STRING },
                            updatedCsv: { type: Type.STRING },
                            requiresConfirmation: { type: Type.BOOLEAN }
                        },
                        required: ["explanation", "updatedCsv", "requiresConfirmation"]
                    }
                }
            });

            const result = JSON.parse(response.text || "{}");
            if (!result.updatedCsv) throw new Error("AI failed to generate CSV.");

            return result as EditPlan;

        } catch (error) {
            console.error("AI Editing Failed:", error);
            throw new Error("Failed to interpret edit command. Please try again.");
        }
    }
};
