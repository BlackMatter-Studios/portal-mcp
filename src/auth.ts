import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthenticatedUser {
  userId: string;
  name: string;
  scopes: string[];
  accessToken: string;
  supabase: SupabaseClient;
}

interface AuthResponse {
  valid?: boolean;
  access_token?: string;
  user_id?: string;
  name?: string;
  scopes?: string[];
  error?: string;
}

export async function authenticateKey(
  apiKey: string,
  supabaseUrl: string,
  anonKey: string,
): Promise<AuthenticatedUser> {
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith("pmcp_")) {
    throw new Error("Invalid API key format. Expected key starting with 'pmcp_'");
  }

  // Call the secure Portal MCP auth exchange endpoint
  const authEndpoint = `${supabaseUrl}/functions/v1/portal-mcp-auth`;

  const response = await fetch(authEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ apiKey: trimmed }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as AuthResponse;
    throw new Error(
      errorBody.error || `Authentication failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as AuthResponse;
  if (!data.valid || !data.access_token) {
    throw new Error(data.error || "Authentication returned invalid session");
  }

  const userId = data.user_id as string;
  const name = data.name as string;
  const scopes = data.scopes || [];
  const accessToken = data.access_token as string;


  // Initialize client authenticated with the user's short-lived JWT session
  // This guarantees native Postgres Row-Level Security (auth.uid() = userId)
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  return {
    userId,
    name,
    scopes,
    accessToken,
    supabase: userClient,
  };
}
