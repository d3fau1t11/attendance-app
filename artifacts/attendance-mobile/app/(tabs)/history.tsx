import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAttendance, type AttendanceSession } from '@/lib/attendance/useAttendance';
import { SessionRow } from '@/components/SessionRow';

type Range = 'week' | 'month' | 'all';

/** Start of the period, so filtering is a simple timestamp comparison. */
function rangeStart(range: Range): number {
  const now = new Date();
  if (range === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return start.getTime();
  }
  if (range === 'month') {
    const start = new Date(now);
    start.setMonth(now.getMonth() - 1);
    return start.getTime();
  }
  return 0;
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { overview, loading, refresh } = useAttendance();
  const [range, setRange] = useState<Range>('week');
  const [refreshing, setRefreshing] = useState(false);

  const sessions = useMemo(() => {
    const cutoff = rangeStart(range);
    return (overview?.sessions ?? []).filter(
      (s) => new Date(s.checkInAt).getTime() >= cutoff,
    );
  }, [overview, range]);

  const stats = useMemo(() => {
    const closed = sessions.filter((s) => s.durationMinutes != null);
    const totalMinutes = closed.reduce(
      (sum, s) => sum + (s.durationMinutes ?? 0),
      0,
    );
    return {
      days: new Set(
        sessions.map((s) => new Date(s.checkInAt).toDateString()),
      ).size,
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      late: sessions.filter((s) => s.isLate).length,
      review: sessions.filter((s) => s.needsReview).length,
    };
  }, [sessions]);

  // Grouping by day gives the list a scannable structure rather than an
  // undifferentiated stream of rows.
  const grouped = useMemo(() => {
    const map = new Map<string, AttendanceSession[]>();
    for (const session of sessions) {
      const key = new Date(session.checkInAt).toDateString();
      const existing = map.get(key);
      if (existing) existing.push(session);
      else map.set(key, [session]);
    }
    return Array.from(map.entries());
  }, [sessions]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 110 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          Attendance history
        </Text>

        <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
          {(['week', 'month', 'all'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setRange(option)}
              style={[
                styles.tab,
                range === option && {
                  backgroundColor: colors.card,
                  shadowOpacity: 0.05,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color:
                      range === option
                        ? colors.foreground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {option === 'week'
                  ? 'This week'
                  : option === 'month'
                    ? 'This month'
                    : 'All'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.statsRow}>
          <Stat label="Days" value={String(stats.days)} />
          <Stat label="Hours" value={`${stats.hours}h ${stats.minutes}m`} />
          <Stat label="Late" value={String(stats.late)} tone={stats.late > 0 ? 'warn' : undefined} />
          <Stat
            label="Review"
            value={String(stats.review)}
            tone={stats.review > 0 ? 'warn' : undefined}
          />
        </View>

        {loading && !overview ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : grouped.length ? (
          grouped.map(([day, daySessions]) => (
            <View key={day} style={styles.group}>
              <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>
                {formatDayHeading(day)}
              </Text>
              {daySessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </View>
          ))
        ) : (
          <View style={styles.empty}>
            <Feather name="inbox" size={30} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No attendance in this period.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function formatDayHeading(day: string): string {
  const date = new Date(day);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.statValue,
          { color: tone === 'warn' ? '#b7791f' : colors.foreground },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  tabs: { flexDirection: 'row', borderRadius: 11, padding: 3, marginBottom: 18 },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
  },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  group: { marginBottom: 14 },
  groupTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
    marginTop: 8,
  },
  loader: { paddingVertical: 40 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
