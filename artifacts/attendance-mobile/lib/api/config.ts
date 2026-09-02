import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Runtime API configuration & Storage wrapper.
 *
 * Safe storage helper that delegates to SecureStore on iOS/Android and
 * localStorage when running in web browser mode.
 */

async function safeGetItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function safeSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function safeDeleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

const KEY_BASE_URL = 'attendance.api.baseUrl';
const KEY_ACCESS = 'attendance.auth.access';
const KEY_REFRESH = 'attendance.auth.refresh';
const KEY_INSTALL = 'attendance.device.installId';

/**
 * Compiled-in default, used until the user overrides it. Set
 * EXPO_PUBLIC_API_URL in .env (e.g. https://attendancesys1.netlify.app) before building.
 */
const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');

let cachedBaseUrl: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  const stored = await safeGetItem(KEY_BASE_URL);
  cachedBaseUrl = stored || DEFAULT_BASE_URL;
  return cachedBaseUrl;
}

export async function setBaseUrlOverride(url: string | null): Promise<void> {
  const normalised = url ? url.trim().replace(/\/+$/, '') : null;
  cachedBaseUrl = normalised || DEFAULT_BASE_URL;
  if (normalised) {
    await safeSetItem(KEY_BASE_URL, normalised);
  } else {
    await safeDeleteItem(KEY_BASE_URL);
  }
}

export function getDefaultBaseUrl(): string {
  return DEFAULT_BASE_URL;
}

// --- Token storage ---------------------------------------------------------

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    safeSetItem(KEY_ACCESS, access),
    safeSetItem(KEY_REFRESH, refresh),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return await safeGetItem(KEY_ACCESS);
}

export async function getRefreshToken(): Promise<string | null> {
  return await safeGetItem(KEY_REFRESH);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    safeDeleteItem(KEY_ACCESS).catch(() => {}),
    safeDeleteItem(KEY_REFRESH).catch(() => {}),
  ]);
}

/**
 * Stable per-install identifier, used as an anti-fraud signal server-side.
 */
export async function getInstallId(): Promise<string> {
  let id = await safeGetItem(KEY_INSTALL).catch(() => null);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await safeSetItem(KEY_INSTALL, id).catch(() => {});
  }
  return id;
}
