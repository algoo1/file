// This service handles all interactions with the Airtable API.

const findPrimaryFieldName = (record: any): string => {
    // Common primary field names in Airtable
    const commonNames = ['Name', 'Title', 'ID', 'Primary', 'Key', 'Task'];
    if (record && record.fields) {
        for (const name of commonNames) {
            if (name in record.fields) {
                return record.fields[name] || record.id;
            }
        }
        // Fallback to the first field with a string value
        for(const key in record.fields) {
            if(typeof record.fields[key] === 'string' && record.fields[key]) {
                return record.fields[key];
            }
        }
    }
    // Final fallback to the record ID
    return record.id;
};

export const airtableService = {
  /**
   * Fetches a list of records from an Airtable table.
   * @param apiKey The Airtable Personal Access Token.
   * @param baseId The ID of the Airtable base.
   * @param tableId The name or ID of the table.
   * @returns A promise that resolves to an array of record metadata.
   */
  getRecords: async (apiKey: string, baseId: string, tableId: string): Promise<{ id: string, name: string }[]> => {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Airtable API error: ${errorData.error?.message || 'Failed to fetch records'} (Code: ${response.status})`);
      }

      const data = await response.json();
      
      return data.records.map((record: any) => ({
        id: record.id,
        name: findPrimaryFieldName(record),
      }));

    } catch (error) {
        console.error("Failed to fetch records from Airtable:", error);
        throw error;
    }
  },

  /**
   * Fetches the full content of a single Airtable record.
   * @param apiKey The Airtable Personal Access Token.
   * @param baseId The ID of the Airtable base.
   * @param tableId The name or ID of the table.
   * @param recordId The ID of the record to fetch.
   * @returns A promise that resolves to the stringified JSON content of the record's fields.
   */
  getRecordContent: async (apiKey: string, baseId: string, tableId: string, recordId: string): Promise<string> => {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`;
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Airtable API error: ${errorData.error?.message || 'Failed to fetch record content'} (Code: ${response.status})`);
      }

      const record = await response.json();
      // Stringify the fields to be used as content for indexing
      return JSON.stringify(record.fields, null, 2);

    } catch (error) {
        console.error(`Failed to fetch content for Airtable record ${recordId}:`, error);
        throw error;
    }
  },
};
