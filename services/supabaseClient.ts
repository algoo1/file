import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqlvgumeakfvjlekxydn.supabase.co';
// The public anonymous key is the correct and secure key for browser-based applications.
// Row Level Security (RLS) policies must be enabled in Supabase to grant write permissions.
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbHZndW1lYWtmdmpsZWt4eWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzODEzMTksImV4cCI6MjA3ODk1NzMxOX0.7d634WpAY0WihTAkBNyVdVJl0D4Dud7hub6DwO_7ULc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
