
// This service manages the loading of external Google scripts to prevent race conditions.

let scriptsLoadedPromise: Promise<void> | null = null;

export const googleApiService = {
  /**
   * Loads the GAPI and GSI client scripts and returns a promise that resolves when both are ready.
   * It ensures the scripts are only loaded once.
   */
  loadScripts: (): Promise<void> => {
    if (scriptsLoadedPromise) {
      return scriptsLoadedPromise;
    }

    scriptsLoadedPromise = new Promise((resolve, reject) => {
      const gapiUrl = 'https://apis.google.com/js/api.js';
      const gsiUrl = 'https://accounts.google.com/gsi/client';

      let gapiLoaded = false;
      let gsiLoaded = false;

      const checkCompletion = () => {
        if (gapiLoaded && gsiLoaded) {
          resolve();
        }
      };

      const gapiScript = document.createElement('script');
      gapiScript.src = gapiUrl;
      gapiScript.async = true;
      gapiScript.defer = true;
      gapiScript.onload = () => {
        gapiLoaded = true;
        checkCompletion();
      };
      gapiScript.onerror = () => reject(new Error('Failed to load Google API script.'));
      document.body.appendChild(gapiScript);

      const gsiScript = document.createElement('script');
      gsiScript.src = gsiUrl;
      gsiScript.async = true;
      gsiScript.defer = true;
      gsiScript.onload = () => {
        gsiLoaded = true;
        checkCompletion();
      };
      gsiScript.onerror = () => reject(new Error('Failed to load Google Sign-In script.'));
      document.body.appendChild(gsiScript);
    });

    return scriptsLoadedPromise;
  },
};
