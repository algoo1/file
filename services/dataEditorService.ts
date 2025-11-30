
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
        uploadedFileName?: string
    ): Promise<EditPlan> => {
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `You are a highly intelligent, world-class Data Operations Agent. 
Your capability is to manipulate structured data (CSV) based on natural language instructions in **ANY language** (Arabic, English, French, Spanish, Chinese, etc.).

**CORE DIRECTIVES:**

1.  **Multilingual Intelligence:** 
    *   The user may speak in Arabic (e.g., "امسح الوصف"), English ("Clear the description"), French ("Effacer la description"), etc.
    *   The CSV headers might be in a completely different language than the user's command.
    *   **Task:** You must intelligently map the user's intent to the correct columns and rows, regardless of language mismatches.

2.  **Precise Action Logic:**
    *   **"Add/Link Image" (CRITICAL):** 
        *   If the user has uploaded an image, you will be provided with its **FILENAME**.
        *   **ACTION:** Insert this **FILENAME** (e.g., "image_12345_shoe.jpg") into the appropriate 'Image', 'Photo', or 'Asset' column. 
        *   **DO NOT** insert a full URL (like http://...). Just the file name or code.
        *   If no image column exists, create one named "Image".
    
    *   **"Delete/Remove Text/Cell":** Clear the specific cell content. Do NOT delete the row unless asked.
    *   **"Delete/Remove Product/Row":** Delete the entire row if asked to remove an item/record.
    *   **"Update/Change":** Modify the specific value with high precision.

3.  **Visual Context Awareness:**
    *   If an image is attached for *analysis* (visual context), use it to identify the product in the CSV.

4.  **Strict Output Format:**
    *   You MUST return a JSON object.
    *   \`explanation\`: A clear, concise summary of exactly what you changed (in the user's language).
    *   \`updatedCsv\`: The complete, valid, raw CSV string.
    *   \`requiresConfirmation\`: true if the request is destructive or ambiguous.

`;

        let prompt = `
**Current CSV Content:**
\`\`\`csv
${originalCsv}
\`\`\`

**User Request:** "${userInstruction}"
`;
        
        // Inject the specific logic for the uploaded file NAME
        if (uploadedFileName) {
            prompt += `\n**SYSTEM EVENT - IMAGE UPLOAD:** 
The user has uploaded an image file.
**FILENAME:** ${uploadedFileName}
**INSTRUCTION:** You MUST insert this **FILENAME** ("${uploadedFileName}") into the row identified by the User Request. Use this filename as the reference code.
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
