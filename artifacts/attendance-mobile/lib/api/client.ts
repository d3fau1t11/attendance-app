import {
  clearTokens,
  getAccessToken,
  getBaseUrl,
  getRefreshToken,
  saveTokens,
} from './config';

/**
 * Thin API client.
 *
 * Deliberately independent of React and of the generated react-query hooks,
 * because the background geofencing task runs headless — outside any component
 * tree — and still needs authenticated requests with the same refresh
 * behaviour.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: unknown;

  constructor(status: number, code: string, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Distinguishes "no network" from "server said no" — the app treats them very differently. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network request failed');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (login, refresh). */
  anonymous?: boolean;
  /** Internal: prevents infinite recursion through the refresh path. */
  _retried?: boolean;
  timeoutMs?: number;
};

/** Serialises concurrent refreshes so a burst of 401s triggers only one. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return false;

    try {
      const baseUrl = await getBaseUrl();
      const response = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        // The refresh token is dead — force a fresh sign-in.
        await clearTokens();
        return false;
      }

      const data = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      await saveTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      // A network failure is not proof the token is invalid; keep it and let
      // the caller retry later rather than logging the user out offline.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    throw new ApiError(
      0,
      'no_server_configured',
      'No server address is configured. Set it in Profile → Server settings.',
    );
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  if (!options.anonymous) {
    const token = await getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  // React Native's fetch has no default timeout; without this a request on a
  // captive-portal Wi-Fi hangs indefinitely and the UI never resolves.
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new NetworkError(error);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && !options.anonymous && !options._retried) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const payload = data as { code?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      payload?.code ?? 'request_failed',
      payload?.message ?? `Request failed (${response.status})`,
      data,
    );
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** True when the API is reachable — used to decide online vs. queue-only mode. */
export async function pingServer(): Promise<boolean> {
  try {
    await apiRequest('/api/healthz', { anonymous: true, timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
