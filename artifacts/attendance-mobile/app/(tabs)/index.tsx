import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth/AuthContext';
import { useAttendance } from '@/lib/attendance/useAttendance';
import {
  checkReadiness,
  requestBackground,
  requestForeground,
  openAppSettings,
  openLocationSettings,
  type ReadinessReport,
} from '@/lib/location/permissions';
import { getLastFixSummary, type LastFixSummary } from '@/lib/background/state';
import { StatusCard } from '@/components/StatusCard';
import { AlertBanner } from '@/components/AlertBanner';
import { SessionRow } from '@/components/SessionRow';

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    overview,
    loading,
    offline,
    pendingCount,
    rejectedCount,
    refresh,
  } = useAttendance();

  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [lastFix, setLastFix] = useState<LastFixSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDiagnostics = useCallback(async () => {
    const [report, fix] = await Promise.all([
      checkReadiness(),
      getLastFixSummary(),
    ]);
    setReadiness(report);
    setLastFix(fix);
  }, []);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadDiagnostics()]);
    setRefreshing(false);
  }, [refresh, loadDiagnostics]);

  const active = overview?.activeSession ?? null;
  const isCheckedIn = Boolean(active);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  const todayLabel = useMemo(
    () =>
      new Date()
        .toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        })
        .toUpperCase(),
    [],
  );

  const handleReadinessAction = async () => {
    if (!readiness) return;
    switch (readiness.status) {
      case 'permission_denied':
        setReadiness(await requestForeground());
        break;
      case 'background_permission_missing':
        setReadiness(await requestBackground());
        break;
      case 'permission_blocked':
        await openAppSettings();
        break;
      case 'services_disabled':
        await openLocationSettings();
        break;
      default:
        await loadDiagnostics();
    }
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
        <View style={styles.topbar}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              {todayLabel}
            </Text>
            <Text style={[styles.greeting, { color: colors.foreground }]}>
              {greeting}, {firstName}
            </Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {firstName.charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Connectivity and sync state are surfaced before anything else —
            the user needs to know whether what they see is current. */}
        {offline && (
          <AlertBanner
            tone="warning"
            icon="cloud-off"
            title="You are offline"
            message="Attendance actions are saved on this device and will sync automatically when you reconnect."
          />
        )}

        {pendingCount > 0 && (
          <AlertBanner
            tone="info"
            icon="upload-cloud"
            title={`${pendingCount} event${pendingCount === 1 ? '' : 's'} waiting to sync`}
            message="These will be sent as soon as a connection is available."
          />
        )}

        {rejectedCount > 0 && (
          <AlertBanner
            tone="error"
            icon="alert-triangle"
            title={`${rejectedCount} event${rejectedCount === 1 ? '' : 's'} not accepted`}
            message="The server declined these. Open Profile to see why."
            actionLabel="View"
            onAction={() => router.push('/(tabs)/profile')}
          />
        )}

        {readiness && readiness.status !== 'ready' && (
          <AlertBanner
            tone={readiness.canCheckIn ? 'warning' : 'error'}
            icon="map-pin"
            title={readiness.title}
            message={readiness.message}
            actionLabel={readiness.actionLabel}
            onAction={() => void handleReadinessAction()}
          />
        )}

        <StatusCard
          session={active}
          lastFix={lastFix}
          onScan={() =>
            router.push(isCheckedIn ? '/scan?mode=check_out' : '/scan')
          }
          disabled={!readiness?.canCheckIn}
        />

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Recent attendance
          </Text>
          <Pressable onPress={() => router.push('/(tabs)/history')} hitSlop={8}>
            <Text style={[styles.link, { color: colors.primary }]}>See all</Text>
          </Pressable>
        </View>

        {loading && !overview ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : overview?.sessions.length ? (
          overview.sessions
            .slice(0, 5)
            .map((session) => <SessionRow key={session.id} session={session} />)
        ) : (
          <View style={styles.empty}>
            <Feather name="calendar" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No attendance yet. Scan the workplace QR code to check in.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  eyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 1.3,
    marginBottom: 5,
  },
  greeting: {
    fontFamily: 'Inter_700Bold',
    fontSize: 23,
    letterSpacing: -0.5,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 6,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  loader: { paddingVertical: 40 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
});
