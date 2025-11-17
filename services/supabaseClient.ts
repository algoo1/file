import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqlvgumeakfvjlekxydn.supabase.co';
// The public anon key is safe to be exposed in a browser environment.
// Row Level Security (RLS) should be enabled in your Supabase project for production.
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbHZndW1lYWtmdmpsZWt4eWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzODEzMTksImV4cCI6MjA3ODk1NzMxOX0.7d634WpAY0WihTAkBNyVdVJl0D4Dud7hub6DwO_7ULc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
