import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { BiometricGuard } from '@/components/BiometricGuard';

/**
 * IMPORTANT: importing this module at the app entry is what registers the
 * background location and geofencing tasks with `TaskManager.defineTask`.
 *
 * Android relaunches the JS bundle headlessly to deliver geofence events; if
 * the tasks were defined inside a component, they would not exist at that
 * moment and exit events would be dropped silently.
 */
import '@/lib/background/tasks';

import { ThemeProvider } from '@/lib/theme/ThemeContext';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Attendance state changes underneath the UI (background task, server
      // sweeper), so cached data is treated as stale immediately.
      staleTime: 0,
    },
  },
});

/**
 * Redirect between the auth and app stacks based on session state.
 *
 * Runs in an effect rather than rendering a `<Redirect>` so that navigation
 * happens after the root layout is mounted — expo-router warns otherwise.
 */
function RootNavigator() {
  const { user, initialising } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initialising) return;

    const inAuthGroup = (segments as string[])[0] === 'login';

    if (!user && !inAuthGroup) {
      router.replace('/login' as any);
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)' as any);
    }
  }, [user, initialising, segments, router]);

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="scan"
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <ThemeProvider>
                <AuthProvider>
                  <BiometricGuard>
                    <RootNavigator />
                  </BiometricGuard>
                </AuthProvider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
