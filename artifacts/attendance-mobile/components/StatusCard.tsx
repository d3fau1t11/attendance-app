import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { ActiveSession } from '@/lib/attendance/useAttendance';
import type { LastFixSummary } from '@/lib/background/state';

/**
 * Primary status surface.
 *
 * Shows three distinct states, because conflating them is what makes
 * attendance apps untrustworthy:
 *
 *   checked in    — tracking is live, elapsed time is accruing
 *   pending exit  — you left; a countdown is running before auto-checkout
 *   checked out   — nothing is being recorded
 */
export function StatusCard({
  session,
  lastFix,
  onScan,
  disabled,
}: {
  session: ActiveSession | null;
  lastFix: LastFixSummary | null;
  onScan: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const [now, setNow] = useState(Date.now());

  // Tick while a session is open so the elapsed time and grace countdown stay
  // live without a manual refresh.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);

  const isPendingExit = session?.status === 'pending_exit';

  const elapsed = session
    ? Math.max(0, now - new Date(session.checkInAt).getTime())
    : 0;
  const hours = Math.floor(elapsed / 3_600_000);
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);

  const graceRemaining =
    isPendingExit && session?.exitGraceUntil
      ? Math.max(0, new Date(session.exitGraceUntil).getTime() - now)
      : 0;
  const graceMinutes = Math.floor(graceRemaining / 60_000);
  const graceSeconds = Math.floor((graceRemaining % 60_000) / 1000);

  const background = isPendingExit ? '#b7791f' : colors.primary;

  return (
    <View style={[styles.card, { backgroundColor: background }]}>
      <View style={styles.header}>
        <View style={styles.orb}>
          <Ionicons
            name={
              isPendingExit
                ? 'alert-circle-outline'
                : session
                  ? 'radio'
                  : 'location-outline'
            }
            size={20}
            color={background}
          />
        </View>
        {session && (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>
              {isPendingExit ? 'GRACE PERIOD' : 'TRACKING'}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.label}>
        {isPendingExit
          ? 'You have left the workplace'
          : session
            ? 'You are checked in'
            : 'Ready when you are'}
      </Text>
      <Text style={styles.place}>
        {session?.workplaceName ?? 'Scan the workplace QR code to start'}
      </Text>

      {session ? (
        <>
          <Text style={styles.time}>
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
          </Text>
          <Text style={styles.hint}>
            {isPendingExit
              ? `Returning within ${graceMinutes}:${String(graceSeconds).padStart(2, '0')} keeps this session open`
              : 'hours on site today'}
          </Text>
        </>
      ) : (
        <Text style={styles.emptyHint}>
          Your location is checked against the workplace boundary. No movement
          history is stored.
        </Text>
      )}

      {/* Surfacing the last evaluated fix makes the geofence legible rather
          than magical — the user can see why they are or are not checked in. */}
      {session && lastFix && (
        <View style={styles.fixRow}>
          <Feather
            name={
              lastFix.verdict === 'inside'
                ? 'check-circle'
                : lastFix.verdict === 'outside'
                  ? 'x-circle'
                  : 'help-circle'
            }
            size={13}
            color="rgba(255,255,255,0.85)"
          />
          <Text style={styles.fixText}>
            {lastFix.verdict === 'inside'
              ? `Inside boundary · ${lastFix.distanceM}m from centre`
              : lastFix.verdict === 'outside'
                ? `Outside boundary · ${lastFix.distanceM}m from centre`
                : `Signal unclear · ±${lastFix.accuracyM}m accuracy`}
          </Text>
        </View>
      )}

      <Pressable
        testID="scan-attendance"
        onPress={onScan}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.card,
            opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="scan-outline" size={20} color={background} />
        <Text style={[styles.buttonText, { color: background }]}>
          {session ? 'Scan to check out' : 'Scan to check in'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: 22, marginTop: 4 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  orb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  liveText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  label: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  place: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 4,
  },
  time: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 46,
    letterSpacing: -2,
    marginTop: 14,
  },
  hint: {
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 18,
  },
  emptyHint: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    marginBottom: 18,
  },
  fixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  fixText: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_500Medium',
    fontSize: 11.5,
  },
  button: {
    borderRadius: 13,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
});
