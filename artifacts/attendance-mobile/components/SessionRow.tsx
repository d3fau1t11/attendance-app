import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { AttendanceSession } from '@/lib/attendance/useAttendance';

/** How a session ended, in language an employee can act on. */
function describeCheckout(session: AttendanceSession): string | null {
  switch (session.checkoutReason) {
    case 'auto_geofence_exit':
      return 'Checked out automatically when you left';
    case 'auto_heartbeat_lost':
      return 'Closed for review — your device stopped reporting';
    case 'auto_workday_end':
      return 'Closed for review — still open after the workday';
    case 'admin_override':
      return 'Adjusted by an administrator';
    default:
      return null;
  }
}

export function SessionRow({ session }: { session: AttendanceSession }) {
  const colors = useColors();

  const isOpen =
    session.status === 'checked_in' || session.status === 'pending_exit';
  const note = describeCheckout(session);

  const checkIn = new Date(session.checkInAt);
  const checkOut = session.checkOutAt ? new Date(session.checkOutAt) : null;

  const duration = session.durationMinutes
    ? `${Math.floor(session.durationMinutes / 60)}h ${session.durationMinutes % 60}m`
    : isOpen
      ? 'Active'
      : '—';

  const tone = session.needsReview
    ? { bg: '#fff4e0', fg: '#b7791f', icon: 'alert-triangle' as const }
    : isOpen
      ? { bg: colors.accent, fg: colors.primary, icon: 'radio' as const }
      : { bg: colors.muted, fg: colors.mutedForeground, icon: 'check' as const };

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={[styles.icon, { backgroundColor: tone.bg }]}>
        <Feather name={tone.icon} size={15} color={tone.fg} />
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={[styles.place, { color: colors.foreground }]} numberOfLines={1}>
            {session.workplaceName}
          </Text>
          {session.isLate && (
            <View style={styles.lateBadge}>
              <Text style={styles.lateText}>LATE</Text>
            </View>
          )}
        </View>

        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {checkIn.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
          {' · '}
          {checkIn.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {checkOut
            ? ` – ${checkOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </Text>

        {note && (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {note}
          </Text>
        )}
      </View>

      <Text style={[styles.duration, { color: colors.foreground }]}>
        {duration}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  place: { fontFamily: 'Inter_600SemiBold', fontSize: 14, flexShrink: 1 },
  lateBadge: {
    backgroundColor: '#fff4e0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  lateText: {
    color: '#b7791f',
    fontFamily: 'Inter_700Bold',
    fontSize: 8.5,
    letterSpacing: 0.5,
  },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  note: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 3,
    fontStyle: 'italic',
  },
  duration: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginLeft: 8 },
});
