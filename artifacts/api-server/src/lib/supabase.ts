import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export async function supabaseRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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