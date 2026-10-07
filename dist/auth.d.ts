import { type SupabaseClient } from "@supabase/supabase-js";
export interface AuthenticatedUser {
    userId: string;
    name: string;
    scopes: string[];
    accessToken: string;
    supabase: SupabaseClient;
}
export declare function authenticateKey(apiKey: string, supabaseUrl: string, anonKey: string): Promise<AuthenticatedUser>;
