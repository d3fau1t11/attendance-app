import React, { useEffect, useState, useCallback } from 'react';
import {
  AppState,
  AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth/AuthContext';
import {
  authenticateBiometric,
  getBiometricStatus,
  isBiometricsEnabled,
} from '@/lib/security/biometrics';

export function BiometricGuard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const [isLocked, setIsLocked] = useState(false);
  const [biometricType, setBiometricType] = useState('Face ID / Fingerprint');
  const [authenticating, setAuthenticating] = useState(false);

  const promptUnlock = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    const success = await authenticateBiometric('Unlock Attendance App');
    setAuthenticating(false);
    if (success) {
      setIsLocked(false);
    }
  }, [authenticating]);

  // Check on initial mount or when user changes
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      if (!user) {
        setIsLocked(false);
        return;
      }
      const enabled = await isBiometricsEnabled();
      if (!enabled) {
        setIsLocked(false);
        return;
      }
      const status = await getBiometricStatus();
      if (isMounted) {
        setBiometricType(status.biometricType);
        setIsLocked(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user]);

  // Prompt automatically when locked and app becomes active
  useEffect(() => {
    if (isLocked && user) {
      void promptUnlock();
    }
  }, [isLocked, user]);

  // Listen for AppState changes to lock when going to background
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        if (nextAppState === 'background' || nextAppState === 'inactive') {
          void (async () => {
            if (user && (await isBiometricsEnabled())) {
              setIsLocked(true);
            }
          })();
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [user]);

  if (!isLocked || !user) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + '20' }]}>
          <Feather name="shield" size={44} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          Attendance Locked
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Biometric protection is enabled. Authenticate using {biometricType} to continue.
        </Text>

        <Pressable
          onPress={() => void promptUnlock()}
          disabled={authenticating}
          style={({ pressed }) => [
            styles.unlockButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed || authenticating ? 0.8 : 1,
            },
          ]}
        >
          <Feather name="unlock" size={18} color="#fff" />
          <Text style={styles.unlockButtonText}>
            {authenticating ? 'Authenticating…' : `Unlock with ${biometricType}`}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void signOut()}
          style={styles.signOutButton}
        >
          <Text style={[styles.signOutText, { color: colors.destructive }]}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 32,
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    paddingVertical: 15,
    borderRadius: 12,
    marginBottom: 16,
  },
  unlockButtonText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  signOutButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  signOutText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
