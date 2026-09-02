import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme as useDeviceColorScheme, Platform } from 'react-native';
import colors from '@/constants/colors';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  isDark: boolean;
  colors: typeof colors.light;
}

const STORAGE_KEY = 'attendance.theme_mode';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useDeviceColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    async function loadTheme() {
      try {
        let stored: string | null = null;
        if (Platform.OS === 'web') {
          stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        } else {
          const SecureStore = await import('expo-secure-store');
          stored = await SecureStore.getItemAsync(STORAGE_KEY);
        }
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      } catch {}
    }
    void loadTheme();
  }, []);

  const setMode = async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, newMode);
      } else {
        const SecureStore = await import('expo-secure-store');
        await SecureStore.setItemAsync(STORAGE_KEY, newMode);
      }
    } catch {}
  };

  const activeScheme = mode === 'system' ? (deviceScheme === 'dark' ? 'dark' : 'light') : mode;
  const isDark = activeScheme === 'dark';
  const activeColors = isDark && 'dark' in colors ? colors.dark : colors.light;

  return (
    <ThemeContext.Provider
      value={{
        mode,
        setMode,
        isDark,
        colors: { ...activeColors, radius: colors.radius } as typeof colors.light,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
