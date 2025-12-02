
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqlvgumeakfvjlekxydn.supabase.co';
// The public anonymous key is safe for browser usage.
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbHZndW1lYWtmdmpsZWt4eWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzODEzMTksImV4cCI6MjA3ODk1NzMxOX0.7d634WpAY0WihTAkBNyVdVJl0D4Dud7hub6DwO_7ULc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const authService = {
  signIn: async (email: string, password: string) => {
    return await supabase.auth.signInWithPassword({ email, password });
  },
  signUp: async (email: string, password: string) => {
    return await supabase.auth.signUp({ email, password });
  },
  signOut: async () => {
    return await supabase.auth.signOut();
  },
  getSession: async () => {
    return await supabase.auth.getSession();
  },
  onAuthStateChange: (callback: (event: any, session: any) => void) => {
    return supabase.auth.onAuthStateChange(callback);
  }
};
