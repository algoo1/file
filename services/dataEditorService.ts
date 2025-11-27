
import { GoogleGenAI, Type } from "@google/genai";
import { Client } from '../types.ts';

interface EditPlan {
    explanation: string;
    updatedCsv: string;
    requiresConfirmation: boolean;
}

export const dataEditorService = {
    /**
     * Generates a plan to modify the CSV data based on a user's natural language request.
     * @param originalCsv The current raw CSV content of the sheet.
     * @param userInstruction The user's command (e.g., "Change price of X to Y").
     * @param apiKey The Gemini API Key.
     * @param image Optional image to provide context (e.g., "Add this product").
     */
    generateEditPlan: async (
        originalCsv: string,
        userInstruction: string,
        apiKey: string,
        image?: { data: string; mimeType: string }
    ): Promise<EditPlan> => {
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `You are a precise Data Editor bot. 
Your task is to take an existing CSV file (Product Inventory) and modify it based on the user's natural language request.

**RULES:**
1. **Preserve Structure:** You MUST output a valid CSV. Do not change headers unless explicitly asked. Do not break the row/column structure.
2. **Precision:** If the user asks to change a specific product, find it by Name or ID. Do not touch other rows.
3. **Smart Handling:** 
   - If deleting: Remove the row completely.
   - If adding: Append a new row with the data provided. Use "N/A" for missing columns.
   - If the user provides an image for a new product, use the image description analysis (if available in context) or placeholders to fill the 'Image' column.
4. **Safety:** If the request is ambiguous (e.g., "Delete everything"), ask for confirmation in the explanation, but still provide the CSV as if the action was taken so the user can preview it.

**OUTPUT FORMAT:**
Return a JSON object with:
- \`explanation\`: A clear, concise summary of exactly what you changed. (e.g., "Updated 'Retail Price' for 'Blue Shirt' from $10 to $12.")
- \`updatedCsv\`: The full, raw CSV string representing the new state of the file.
`;

        const prompt = `
**Current CSV Content:**
\`\`\`csv
${originalCsv}
\`\`\`

**User Request:** "${userInstruction}"

${image ? "**(Note: An image was provided with this request. If this is an 'Add Product' request, assume the image belongs to the new item.)**" : ""}

Generate the JSON response.
`;

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
