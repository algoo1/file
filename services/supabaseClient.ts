import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqlvgumeakfvjlekxydn.supabase.co';
// WARNING: This is the service_role key.
// It provides full admin access to your database and bypasses all security policies.
// This is used to ensure the application works without configuring Row Level Security (RLS).
// For production environments, it is STRONGLY recommended to:
// 1. Use the public anon key.
// 2. Enable RLS on all tables.
// 3. Create specific policies to grant necessary permissions.
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbHZndW1lYWtmdmpsZWt4eWRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzM4MTMxOSwiZXhwIjoyMDc4OTU3MzE5fQ.dAvPePq8TAGI6NiTjs8uC1JReda6geCiLm-ulE9kYmI';

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
