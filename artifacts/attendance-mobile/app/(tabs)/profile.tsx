import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Device from 'expo-device';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth/AuthContext';
import {
  checkReadiness,
  openAppSettings,
  openLocationSettings,
  requestBackground,
  requestBatteryOptimisationExemption,
  requestForeground,
  type ReadinessReport,
} from '@/lib/location/permissions';
import { getTrackingStatus } from '@/lib/background/tasks';
import {
  countPending,
  dismissRejected,
  getRejected,
  type OutboxEvent,
} from '@/lib/outbox/store';
import { syncOutbox } from '@/lib/outbox/sync';
import { getBaseUrl } from '@/lib/api/config';
import { ServerUrlSheet } from '@/components/ServerUrlSheet';

/**
 * Diagnostics and account controls.
 *
 * The permission health section exists because silent tracking failure is the
 * defining failure mode of attendance apps: everything looks fine until a
 * month of missing check-outs surfaces. Here the user can see, at a glance,
 * whether tracking will actually work.
 */
export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [tracking, setTracking] = useState({
    geofencingActive: false,
    locationUpdatesActive: false,
  });
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState<OutboxEvent[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [serverSheet, setServerSheet] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [report, status, pendingCount, rejectedList, url] = await Promise.all([
      checkReadiness(),
      getTrackingStatus(),
      countPending(),
      getRejected(),
      getBaseUrl(),
    ]);
    setReadiness(report);
    setTracking(status);
    setPending(pendingCount);
    setRejected(rejectedList);
    setBaseUrl(url);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    const result = await syncOutbox();
    setSyncing(false);
    await load();
    Alert.alert(
      'Sync complete',
      result.offline
        ? 'Still offline — events remain queued on this device.'
        : `${result.accepted} sent, ${result.duplicates} already recorded, ${result.rejected} not accepted.`,
    );
  };

  const confirmSignOut = () => {
    Alert.alert(
      'Sign out?',
      pending > 0
        ? `${pending} event${pending === 1 ? '' : 's'} have not synced yet and will be lost. Sync before signing out.`
        : 'You will need to sign in again to record attendance.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 110 },
        ]}
      >
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>
              {(user?.fullName ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {user?.fullName}
            </Text>
            <Text style={[styles.email, { color: colors.mutedForeground }]}>
              {user?.email}
            </Text>
          </View>
        </View>

        <Section title="Tracking health">
          <HealthRow
            ok={Boolean(readiness?.canCheckIn)}
            label="Location permission"
            detail={
              readiness?.canCheckIn
                ? 'Granted'
                : 'Required to record attendance'
            }
            action={
              readiness?.canCheckIn
                ? undefined
                : {
                    label: 'Fix',
                    onPress: async () => {
                      const next =
                        readiness?.status === 'permission_blocked'
                          ? (await openAppSettings(), await checkReadiness())
                          : await requestForeground();
                      setReadiness(next);
                    },
                  }
            }
          />
          <HealthRow
            ok={Boolean(readiness?.canTrackInBackground)}
            label="Background location"
            detail={
              readiness?.canTrackInBackground
                ? 'Allowed all the time'
                : 'Without this you will not be checked out automatically'
            }
            action={
              readiness?.canTrackInBackground
                ? undefined
                : {
                    label: 'Fix',
                    onPress: async () => setReadiness(await requestBackground()),
                  }
            }
          />
          <HealthRow
            ok={tracking.geofencingActive}
            label="Geofence monitoring"
            detail={
              tracking.geofencingActive
                ? 'Active — exits detected with the app closed'
                : 'Not registered yet'
            }
          />
          <HealthRow
            ok={tracking.locationUpdatesActive}
            label="Live tracking service"
            detail={
              tracking.locationUpdatesActive
                ? 'Running for your open session'
                : 'Runs only while you are checked in'
            }
            neutral={!tracking.locationUpdatesActive}
          />

          {/* No API can reliably report battery-optimisation state, so this is
              offered as an action rather than shown as a status. */}
          <Pressable
            onPress={() => void requestBatteryOptimisationExemption()}
            style={[styles.actionRow, { borderTopColor: colors.border }]}
          >
            <Feather name="battery-charging" size={17} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                Battery optimisation
              </Text>
              <Text
                style={[styles.actionDetail, { color: colors.mutedForeground }]}
              >
                If your phone restricts this app in the background, exits may be
                missed. Tap to allow unrestricted background activity.
              </Text>
            </View>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </Pressable>
        </Section>

        <Section title="Sync">
          <View style={styles.syncRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                {pending === 0
                  ? 'Everything is synced'
                  : `${pending} event${pending === 1 ? '' : 's'} pending`}
              </Text>
              <Text
                style={[styles.actionDetail, { color: colors.mutedForeground }]}
              >
                Queued events sync automatically when you have a connection.
              </Text>
            </View>
            <Pressable
              onPress={() => void handleSync()}
              disabled={syncing}
              style={[
                styles.syncButton,
                { backgroundColor: colors.primary, opacity: syncing ? 0.6 : 1 },
              ]}
            >
              <Text style={styles.syncButtonText}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </Text>
            </Pressable>
          </View>

          {rejected.map((event) => (
            <View
              key={event.clientEventId}
              style={[styles.rejected, { borderTopColor: colors.border }]}
            >
              <Feather name="alert-circle" size={16} color="#c23b3b" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rejectedTitle, { color: colors.foreground }]}>
                  {event.eventType.replace('_', ' ')} not accepted
                </Text>
                <Text style={[styles.rejectedText, { color: colors.mutedForeground }]}>
                  {event.lastError}
                </Text>
                <Text style={[styles.rejectedText, { color: colors.mutedForeground }]}>
                  {new Date(event.occurredAt).toLocaleString()}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  await dismissRejected(event.clientEventId);
                  await load();
                }}
                hitSlop={8}
              >
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </Section>

        <Section title="Privacy">
          <View style={styles.privacy}>
            <Feather name="shield" size={17} color={colors.primary} />
            <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
              Your location is used only to check whether you are inside your
              workplace boundary. Coordinates are recorded at check-in and
              check-out for verification; routine background checks store only
              whether you were inside, never a movement history.
            </Text>
          </View>
        </Section>

        <Section title="Connection">
          <Pressable
            onPress={() => setServerSheet(true)}
            style={styles.actionRow}
          >
            <Feather name="server" size={17} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                Server address
              </Text>
              <Text
                style={[styles.actionDetail, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {baseUrl || 'Not configured'}
              </Text>
            </View>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </Pressable>

          <View style={[styles.deviceRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.deviceLabel, { color: colors.mutedForeground }]}>
              Device
            </Text>
            <Text style={[styles.deviceValue, { color: colors.foreground }]}>
              {Device.modelName ?? 'Unknown'} · {Device.osName}{' '}
              {Device.osVersion}
            </Text>
          </View>
        </Section>

        <Pressable onPress={confirmSignOut} style={styles.signOut}>
          <Feather name="log-out" size={17} color={colors.destructive} />
          <Text style={[styles.signOutText, { color: colors.destructive }]}>
            Sign out
          </Text>
        </Pressable>
      </ScrollView>

      <ServerUrlSheet
        visible={serverSheet}
        onClose={() => {
          setServerSheet(false);
          void load();
        }}
      />
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function HealthRow({
  ok,
  label,
  detail,
  action,
  neutral,
}: {
  ok: boolean;
  label: string;
  detail: string;
  action?: { label: string; onPress: () => void | Promise<void> };
  neutral?: boolean;
}) {
  const colors = useColors();
  const tint = neutral ? colors.mutedForeground : ok ? colors.primary : '#c23b3b';

  return (
    <View style={[styles.healthRow, { borderTopColor: colors.border }]}>
      <Feather
        name={neutral ? 'minus-circle' : ok ? 'check-circle' : 'alert-circle'}
        size={17}
        color={tint}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionTitle, { color: colors.foreground }]}>
          {label}
        </Text>
        <Text style={[styles.actionDetail, { color: colors.mutedForeground }]}>
          {detail}
        </Text>
      </View>
      {action && (
        <Pressable
          onPress={() => void action.onPress()}
          style={[styles.fixButton, { borderColor: colors.primary }]}
        >
          <Text style={[styles.fixText, { color: colors.primary }]}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 20 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  email: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  section: { marginBottom: 22 },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  actionDetail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  fixButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  fixText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  syncButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
  },
  syncButtonText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  rejected: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rejectedTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    textTransform: 'capitalize',
  },
  rejectedText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11.5,
    marginTop: 2,
    lineHeight: 16,
  },
  privacy: { flexDirection: 'row', gap: 11, padding: 14 },
  privacyText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  deviceRow: {
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deviceLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  deviceValue: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 3 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 4,
  },
  signOutText: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
});
