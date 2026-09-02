import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { apiRequest, NetworkError } from '@/lib/api/client';
import { countPending, countRejected, enqueue } from '@/lib/outbox/store';
import { syncOutbox } from '@/lib/outbox/sync';
import { setActiveGeofence } from '@/lib/background/state';
import {
  startGeofencing,
  startLocationUpdates,
  stopLocationUpdates,
} from '@/lib/background/tasks';

export type AttendanceSession = {
  id: string;
  status: 'checked_in' | 'pending_exit' | 'checked_out' | 'needs_review';
  workplaceName: string;
  checkInAt: string;
  checkOutAt: string | null;
  durationMinutes: number | null;
  isLate: boolean;
  needsReview: boolean;
  flags: string[];
  checkoutReason: string | null;
};

export type ActiveSession = {
  id: string;
  status: 'checked_in' | 'pending_exit';
  workplaceId: string;
  workplaceName: string;
  checkInAt: string;
  exitGraceUntil: string | null;
  geofence: { latitude: number; longitude: number; radiusM: number };
};

export type AttendanceOverview = {
  currentStatus: string;
  activeSession: ActiveSession | null;
  sessions: AttendanceSession[];
};

export type Workplace = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  exitBufferM: number;
  maxAccuracyM: number;
  exitGraceSeconds: number;
};

/**
 * Attendance state for the UI.
 *
 * Hand-rolled rather than react-query because the same data is mutated by the
 * headless background task, and the source of truth needs to be re-read on
 * every foreground transition regardless of cache policy.
 */
export function useAttendance() {
  const [overview, setOverview] = useState<AttendanceOverview | null>(null);
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshCounts = useCallback(async () => {
    const [pending, rejected] = await Promise.all([
      countPending(),
      countRejected(),
    ]);
    if (!mounted.current) return;
    setPendingCount(pending);
    setRejectedCount(rejected);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [data, wp] = await Promise.all([
        apiRequest<AttendanceOverview>('/api/attendance/me'),
        apiRequest<{ workplaces: Workplace[] }>('/api/attendance/my-workplaces'),
      ]);
      if (!mounted.current) return;

      setOverview(data);
      setWorkplaces(wp.workplaces);
      setOffline(false);

      // Register OS geofences for every assigned workplace, so an exit is
      // detected even if the app is not running.
      await startGeofencing(
        wp.workplaces.map((w) => ({
          id: w.id,
          latitude: w.latitude,
          longitude: w.longitude,
          radiusM: w.radiusM,
        })),
      ).catch(() => {});

      // The foreground service runs only while a session is open.
      if (data.activeSession) {
        const workplace = wp.workplaces.find(
          (w) => w.id === data.activeSession!.workplaceId,
        );
        if (workplace) {
          await setActiveGeofence({
            workplaceId: workplace.id,
            workplaceName: workplace.name,
            latitude: workplace.latitude,
            longitude: workplace.longitude,
            radiusM: workplace.radiusM,
            exitBufferM: workplace.exitBufferM,
            maxAccuracyM: workplace.maxAccuracyM,
          });
          await startLocationUpdates(workplace.name).catch(() => {});
        }
      } else {
        await setActiveGeofence(null);
        await stopLocationUpdates().catch(() => {});
      }
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof NetworkError) setOffline(true);
    } finally {
      if (mounted.current) setLoading(false);
      await refreshCounts();
    }
  }, [refreshCounts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-read on foreground: the background task may have changed the session
  // while the UI was suspended.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          void syncOutbox().then(() => refresh());
        }
      },
    );
    return () => subscription.remove();
  }, [refresh]);

  // Drain the outbox the moment connectivity returns.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setOffline(!online);
      if (online) {
        void syncOutbox().then((result) => {
          if (result.accepted > 0 || result.rejected > 0) void refresh();
          else void refreshCounts();
        });
      }
    });
    return () => unsubscribe();
  }, [refresh, refreshCounts]);

  /** Queue an event locally — used when offline or when a request fails. */
  const queueEvent = useCallback(
    async (
      eventType: 'check_in' | 'check_out',
      payload: Record<string, unknown>,
    ) => {
      await enqueue({ eventType, payload, occurredAt: new Date() });
      await refreshCounts();
    },
    [refreshCounts],
  );

  return {
    overview,
    workplaces,
    loading,
    offline,
    pendingCount,
    rejectedCount,
    refresh,
    refreshCounts,
    queueEvent,
  };
}
