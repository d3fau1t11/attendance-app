import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { apiRequest, ApiError, NetworkError } from '@/lib/api/client';
import { getInstallId } from '@/lib/api/config';
import { enqueue } from '@/lib/outbox/store';
import { getCurrentFix, checkReadiness } from '@/lib/location/permissions';

type Phase =
  | 'scanning'
  | 'locating'
  | 'submitting'
  | 'success'
  | 'error'
  | 'queued';

/**
 * QR scan → location verification → check-in.
 *
 * The order is fixed and enforced server-side too: a valid code alone never
 * produces attendance, and neither does being in the right place. Both must
 * hold, and the user is told precisely which one failed.
 */
export default function ScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  /**
   * Checking out still requires a scan: it proves the person ending the session
   * is at the workplace, rather than tapping a button from home.
   */
  const isCheckOut = params.mode === 'check_out';
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [message, setMessage] = useState<string>('');
  const [detail, setDetail] = useState<string | null>(null);
  // Guards against the camera firing repeatedly for the same code while an
  // async check-in is still in flight.
  const handling = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const reset = useCallback(() => {
    handling.current = false;
    setPhase('scanning');
    setMessage('');
    setDetail(null);
  }, []);

  const handleScan = useCallback(
    async ({ data: qrToken }: { data: string }) => {
      if (handling.current) return;
      handling.current = true;

      try {
        // --- Location ---
        setPhase('locating');
        setMessage('Confirming you are at the workplace…');

        const readiness = await checkReadiness();
        if (!readiness.canCheckIn) {
          setPhase('error');
          setMessage(readiness.title);
          setDetail(`${readiness.message}\n\nNo attendance was recorded.`);
          return;
        }

        const fixResult = await getCurrentFix();
        if (!fixResult.ok) {
          setPhase('error');
          setMessage(
            fixResult.reason === 'timeout'
              ? 'Could not get a GPS fix in time'
              : 'Location unavailable',
          );
          setDetail(
            'Your position could not be confirmed, so no attendance was recorded. Move to an open area and try again.',
          );
          return;
        }

        // --- Submit ---
        setPhase('submitting');
        setMessage('Recording attendance…');

        const installId = await getInstallId();
        const occurredAt = new Date();
        const payload = {
          qrToken,
          latitude: fixResult.fix.latitude,
          longitude: fixResult.fix.longitude,
          accuracyM: fixResult.fix.accuracyM,
          isMocked: fixResult.fix.isMocked,
          occurredAt: occurredAt.toISOString(),
          device: {
            installId,
            model: Device.modelName,
            osName: Device.osName,
            osVersion: Device.osVersion,
          },
        };

        try {
          const endpoint = isCheckOut
            ? '/api/attendance/check-out'
            : '/api/attendance/check-in';
          const result = await apiRequest<{ sessionId: string; flags?: string[] }>(
            endpoint,
            { method: 'POST', body: { ...payload, clientEventId: makeId() } },
          );

          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
          setPhase('success');
          setMessage(isCheckOut ? 'Checked out' : 'Checked in');
          setDetail(
            result.flags?.length
              ? 'Recorded, but flagged for review by your administrator.'
              : isCheckOut
                ? 'Your attendance session has ended.'
                : 'Your attendance session has started.',
          );
          setTimeout(() => router.back(), 1600);
        } catch (error) {
          if (error instanceof NetworkError) {
            // Offline: queue it. The QR token is stored with the event so the
            // server can still verify it on replay — though a rotating code may
            // have expired by then, which the server will say plainly.
            await enqueue({
              eventType: isCheckOut ? 'check_out' : 'check_in',
              payload: { ...payload, source: 'offline' },
              occurredAt,
            });
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Warning,
            );
            setPhase('queued');
            setMessage('Saved on this device');
            setDetail(
              `You are offline. This ${isCheckOut ? 'check-out' : 'check-in'} is pending synchronisation and will be sent automatically when you reconnect.`,
            );
            setTimeout(() => router.back(), 2400);
            return;
          }

          if (error instanceof ApiError) {
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Error,
            );
            setPhase('error');
            setMessage(errorTitle(error.code));
            setDetail(`${error.message}\n\nNo attendance was recorded.`);
            return;
          }

          throw error;
        }
      } catch {
        setPhase('error');
        setMessage('Something went wrong');
        setDetail('No attendance was recorded. Please try again.');
      }
    },
    [router, isCheckOut],
  );

  if (!permission?.granted) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.background }]}>
        <Feather name="camera-off" size={34} color={colors.mutedForeground} />
        <Text style={[styles.fallbackTitle, { color: colors.foreground }]}>
          Camera access needed
        </Text>
        <Text style={[styles.fallbackText, { color: colors.mutedForeground }]}>
          The camera is used only to read the workplace QR code.
        </Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={[styles.fallbackButton, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.fallbackButtonText}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={styles.fallbackCancel}>
          <Text style={{ color: colors.mutedForeground }}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  const busy = phase === 'locating' || phase === 'submitting';

  return (
    <View style={styles.screen}>
      {phase === 'scanning' && (
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void handleScan({ data })}
        />
      )}

      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.topTitle}>
          {isCheckOut ? 'Scan to check out' : 'Scan workplace code'}
        </Text>
      </View>

      {phase === 'scanning' && (
        <>
          <View style={styles.frame} />
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 28 }]}>
            <Text style={styles.hint}>
              Point your camera at the code displayed at the entrance
            </Text>
          </View>
        </>
      )}

      {phase !== 'scanning' && (
        <View style={styles.overlay}>
          <View style={styles.panel}>
            {busy ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <View
                style={[
                  styles.resultIcon,
                  {
                    backgroundColor:
                      phase === 'success'
                        ? '#0f8f6b'
                        : phase === 'queued'
                          ? '#b7791f'
                          : '#c23b3b',
                  },
                ]}
              >
                <Feather
                  name={
                    phase === 'success'
                      ? 'check'
                      : phase === 'queued'
                        ? 'clock'
                        : 'x'
                  }
                  size={30}
                  color="#fff"
                />
              </View>
            )}

            <Text style={styles.panelTitle}>{message}</Text>
            {detail && <Text style={styles.panelDetail}>{detail}</Text>}

            {phase === 'error' && (
              <View style={styles.panelActions}>
                <Pressable onPress={reset} style={styles.retry}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
                <Pressable onPress={() => router.back()} style={styles.cancel}>
                  <Text style={styles.cancelText}>Close</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Map server error codes to headings the user can act on. */
function errorTitle(code: string): string {
  switch (code) {
    case 'qr_expired':
      return 'That code has expired';
    case 'qr_invalid':
      return 'Not a valid workplace code';
    case 'outside_geofence':
      return 'You are outside the workplace';
    case 'accuracy_too_poor':
      return 'GPS signal too weak';
    case 'not_assigned':
      return 'Not assigned to this workplace';
    case 'already_checked_in':
      return 'Already checked in';
    case 'not_checked_in':
      return 'You are not checked in';
    default:
      return 'Check-in failed';
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    zIndex: 2,
  },
  close: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 17 },
  frame: {
    position: 'absolute',
    top: '30%',
    left: '13%',
    width: '74%',
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 26,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(6,12,10,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  panel: { alignItems: 'center', maxWidth: 320 },
  resultIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  panelTitle: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 19,
    textAlign: 'center',
    marginTop: 8,
  },
  panelDetail: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
  panelActions: { flexDirection: 'row', gap: 12, marginTop: 28 },
  retry: {
    backgroundColor: '#fff',
    paddingHorizontal: 26,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: '#12202a', fontFamily: 'Inter_700Bold', fontSize: 14 },
  cancel: {
    paddingHorizontal: 22,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  cancelText: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  fallbackTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, marginTop: 6 },
  fallbackText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  fallbackButton: {
    height: 48,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  fallbackButtonText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  fallbackCancel: { paddingVertical: 12 },
});
