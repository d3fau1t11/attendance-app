import * as SecureStore from 'expo-secure-store';

/**
 * Runtime API configuration.
 *
 * The base URL is editable at runtime because during development the server
 * runs on a laptop whose LAN address changes between networks. Baking it into
 * the bundle would mean a rebuild every time you move between home and office.
 */

const KEY_BASE_URL = 'attendance.api.baseUrl';
const KEY_ACCESS = 'attendance.auth.access';
const KEY_REFRESH = 'attendance.auth.refresh';
const KEY_INSTALL = 'attendance.device.installId';

/**
 * Compiled-in default, used until the user overrides it. Set
 * EXPO_PUBLIC_API_URL in .env (e.g. http://192.168.1.20:5000) before building.
 */
const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');

let cachedBaseUrl: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  try {
    const stored = await SecureStore.getItemAsync(KEY_BASE_URL);
    cachedBaseUrl = stored || DEFAULT_BASE_URL;
  } catch {
    cachedBaseUrl = DEFAULT_BASE_URL;
  }
  return cachedBaseUrl;
}

export async function setBaseUrlOverride(url: string | null): Promise<void> {
  const normalised = url ? url.trim().replace(/\/+$/, '') : null;
  cachedBaseUrl = normalised || DEFAULT_BASE_URL;
  if (normalised) {
    await SecureStore.setItemAsync(KEY_BASE_URL, normalised);
  } else {
    await SecureStore.deleteItemAsync(KEY_BASE_URL);
  }
}

export function getDefaultBaseUrl(): string {
  return DEFAULT_BASE_URL;
}

// --- Token storage ---------------------------------------------------------

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS, access),
    SecureStore.setItemAsync(KEY_REFRESH, refresh),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_ACCESS);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_REFRESH);
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {}),
  ]);
}

/**
 * Stable per-install identifier, used as an anti-fraud signal server-side.
 * Generated once and kept in SecureStore; a reinstall yields a new id, which
 * the server flags for review rather than blocking.
 */
export async function getInstallId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEY_INSTALL).catch(() => null);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await SecureStore.setItemAsync(KEY_INSTALL, id).catch(() => {});
  }
  return id;
}
