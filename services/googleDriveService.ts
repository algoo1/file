
import { FileObject } from '../types.ts';

// Mock database of files in Google Drive
const mockDrive: Record<string, Omit<FileObject, 'summary' | 'status'>[]> = {
  'drive/folder/client-a-files': [
    { id: 'drive_1', name: 'Q1_Sales.sheet', type: 'sheet', content: 'Product,Revenue\nChairs,5000\nTables,8000' },
    { id: 'drive_2', name: 'Marketing_Plan.pdf', type: 'pdf', content: 'Our main strategy is to focus on social media.' },
  ],
  'drive/folder/client-b-files': [
     { id: 'drive_3', name: 'Project_Timeline.pdf', type: 'pdf', content: 'Phase 1 will be completed by August.' },
  ],
};

// Simulate changes in the drive every 7 seconds
setInterval(() => {
    const folder = 'drive/folder/client-a-files';
    if (mockDrive[folder]) {
        const fileCount = mockDrive[folder].length;
        // Randomly add or modify a file
        if (Math.random() > 0.5) {
            const newFileId = `drive_${Date.now()}`;
            console.log("Simulating file add in Google Drive:", newFileId);
            mockDrive[folder].push({
                id: newFileId,
                name: `New_Report_${Math.floor(Math.random() * 100)}.pdf`,
                type: 'pdf',
                content: `This is new content added at ${new Date().toLocaleTimeString()}`
            });
        } else if (fileCount > 0) {
            const fileToUpdate = mockDrive[folder][0];
            fileToUpdate.content += `\nUpdated at ${new Date().toLocaleTimeString()}`;
            console.log("Simulating file update in Google Drive:", fileToUpdate.name);
        }
    }
}, 7000); // Change more slowly than the 5-second poll to see changes


export const googleDriveService = {
  /**
   * Simulates an OAuth flow to connect to Google Drive.
   */
  connect: async (): Promise<boolean> => {
    console.log("Connecting to Google Drive...");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
    console.log("Connected to Google Drive.");
    return true;
  },

  /**
   * Simulates fetching a list of files and their content from a Google Drive folder.
   * @param folderUrl The URL of the folder to fetch from.
   */
  getFilesFromFolder: async (folderUrl: string): Promise<Omit<FileObject, 'summary' | 'status'>[]> => {
    console.log(`Fetching files from Google Drive folder: ${folderUrl}`);
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
    
    // In a real scenario, you'd use the Google Drive API here.
    // For this mock, we'll just return the files from our mock database.
    if (mockDrive[folderUrl]) {
        // Return a deep copy to prevent mutation issues
        return JSON.parse(JSON.stringify(mockDrive[folderUrl]));
    }
    
    // If folder doesn't exist in mock, create it to simulate a new client
    mockDrive[folderUrl] = [];
    console.log(`Created a new mock folder: ${folderUrl}`);
    return [];
  },
};