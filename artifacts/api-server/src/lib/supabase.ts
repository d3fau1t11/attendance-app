import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export async function supabaseRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (supabaseUrl && supabaseKey) {
    const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`;
    const headers = new Headers(init.headers);
    headers.set("apikey", supabaseKey);
    headers.set("Authorization", `Bearer ${supabaseKey}`);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    return fetch(url, {
      ...init,
      headers,
    });
  }

  return connectors.proxy("supabase", `/rest/v1/${path}`, {
    ...init,
    headers: Object.fromEntries([
      ["Content-Type", "application/json"],
      ["Accept", "application/json"],
      ...new Headers(init.headers).entries(),
    ]),
  });
}

export async function readSupabase<T>(path: string): Promise<T> {
  const response = await supabaseRequest(path);
  if (!response.ok) {
    throw new Error(`Supabase request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}