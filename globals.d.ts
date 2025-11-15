// This file provides TypeScript definitions for the Google API and Identity Services clients,
// which are loaded from external scripts in index.html.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  // Extend the window object
  interface Window {
    gapi: any;
    google: any;
  }
}

// This export is necessary to make this file a module and allow global declarations.
export {};
