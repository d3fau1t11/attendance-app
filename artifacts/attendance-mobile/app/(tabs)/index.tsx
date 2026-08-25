import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  type AttendanceEventInput,
  getGetMyAttendanceQueryKey,
  useCheckIn,
  useCheckOut,
  useGetMyAttendance,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const QUEUE_KEY = 'attendance.pending-events';
const workplace = { id: 'hq-addis', name: 'Addis Ababa HQ', latitude: 9.0192, longitude: 38.7468, radius: 150 };

function makeEvent(eventType: 'check_in' | 'check_out', qrToken: string, coords: Location.LocationObject): AttendanceEventInput {
  return {
    eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    workplaceId: workplace.id,
    occurredAt: new Date().toISOString(),
    latitude: coords.coords.latitude,
    longitude: coords.coords.longitude,
    accuracyMeters: coords.coords.accuracy ?? 999,
    qrToken,
    isMockLocation: false,
    source: 'online',
  };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetMyAttendance();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [offline, setOffline] = useState(false);

  const loadQueue = useCallback(async () => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    setPendingCount(raw ? JSON.parse(raw).length : 0);
  }, []);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const status = data?.currentStatus ?? 'checked_out';
  const active = data?.activeSession;
  const hours = useMemo(() => active ? Math.max(0, Math.floor((Date.now() - new Date(active.checkInAt).getTime()) / 3600000)) : 0, [active]);

  const queueEvent = async (event: AttendanceEventInput) => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, event]));
    setPendingCount(queue.length + 1);
  };

  const handleScan = async ({ data: qrToken }: { data: string }) => {
    if (processing) return;
    setProcessing(true);
    setScannerOpen(false);
    try {
      const locationPermission = await Location.requestForegroundPermissionsAsync();
      if (!locationPermission.granted) {
        Alert.alert('Location is required', 'We use your location only to confirm you are inside the workplace boundary. Attendance was not recorded.');
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const accuracy = location.coords.accuracy ?? 999;
      const distance = distanceMeters(location.coords.latitude, location.coords.longitude, workplace.latitude, workplace.longitude);
      if (accuracy > 100 || distance > workplace.radius) {
        Alert.alert('Outside workplace boundary', `Move closer to ${workplace.name} and try again. Your location was not saved as an attendance event.`);
        return;
      }
      const event = makeEvent(status === 'checked_in' ? 'check_out' : 'check_in', qrToken, location);
      if (offline) {
        await queueEvent({ ...event, source: 'offline' });
        Alert.alert('Saved for sync', 'You are offline. This event is pending synchronization and will be sent when connection returns.');
      } else {
        const mutation = status === 'checked_in' ? checkOut : checkIn;
        await mutation.mutateAsync({ data: event });
        await queryClient.invalidateQueries({ queryKey: getGetMyAttendanceQueryKey() });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      await queueEvent({ ...makeEvent(status === 'checked_in' ? 'check_out' : 'check_in', qrToken, { coords: { latitude: 0, longitude: 0, accuracy: 999 } } as Location.LocationObject), source: 'offline' });
      setOffline(true);
      Alert.alert('Saved for sync', 'Connection is unavailable. The event is pending review and synchronization.');
    } finally {
      setProcessing(false);
    }
  };

  const openScanner = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Use the Android app', 'QR scanning is available on Android through the device camera.');
      return;
    }
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setScannerOpen(true);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <FlatList
        data={data?.sessions ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        ListHeaderComponent={
          <View>
            <View style={styles.topbar}>
              <View>
                <Text style={[styles.eyebrow, { color: colors.primary }]}>MONDAY, 24 AUG</Text>
                <Text style={[styles.greeting, { color: colors.foreground }]}>Good morning, Abebe</Text>
              </View>
              <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>A</Text>
              </View>
            </View>
            <View style={[styles.statusCard, { backgroundColor: colors.primary }]}>
              <View style={styles.statusOrb}><Ionicons name={status === 'checked_in' ? 'radio' : 'location-outline'} size={22} color={colors.primary} /></View>
              <Text style={styles.statusLabel}>{status === 'checked_in' ? 'You are checked in' : 'Ready when you are'}</Text>
              <Text style={styles.statusPlace}>{active?.workplaceName ?? workplace.name}</Text>
              <Text style={styles.statusTime}>{active ? `${String(hours).padStart(2, '0')}:00` : '— —'}</Text>
              <Text style={styles.statusHint}>{active ? 'hours on site today' : 'Scan the workplace QR to start'}</Text>
              <Pressable testID="scan-attendance" onPress={() => void openScanner()} style={({ pressed }) => [styles.scanButton, { backgroundColor: colors.card, opacity: pressed ? 0.82 : 1 }]}>
                <Ionicons name="scan-outline" size={21} color={colors.primary} />
                <Text style={[styles.scanText, { color: colors.primary }]}>{status === 'checked_in' ? 'Scan to check out' : 'Scan to check in'}</Text>
              </Pressable>
            </View>
            <View style={styles.quickRow}>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="clock" size={18} color={colors.primary} /><Text style={[styles.quickValue, { color: colors.foreground }]}>{active ? 'On site' : 'Off site'}</Text><Text style={[styles.quickLabel, { color: colors.mutedForeground }]}>Status</Text></View>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="calendar" size={18} color={colors.primary} /><Text style={[styles.quickValue, { color: colors.foreground }]}>{data?.sessions?.length ?? 0}</Text><Text style={[styles.quickLabel, { color: colors.mutedForeground }]}>This month</Text></View>
              <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="wifi-off" size={18} color={offline || pendingCount ? colors.destructive : colors.primary} /><Text style={[styles.quickValue, { color: colors.foreground }]}>{pendingCount}</Text><Text style={[styles.quickLabel, { color: colors.mutedForeground }]}>Pending</Text></View>
            </View>
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent attendance</Text><Pressable onPress={() => void refetch()}><Text style={[styles.link, { color: colors.primary }]}>Refresh</Text></Pressable></View>
            {isError && <View style={[styles.notice, { backgroundColor: colors.accent }]}><Feather name="cloud-off" size={16} color={colors.primary} /><Text style={[styles.noticeText, { color: colors.accentForeground }]}>Couldn’t reach the server. Your device is ready to queue events.</Text></View>}
            {pendingCount > 0 && <View style={[styles.notice, { backgroundColor: '#fff3df' }]}><Feather name="clock" size={16} color="#a86b16" /><Text style={[styles.noticeText, { color: '#7d5011' }]}>{pendingCount} event{pendingCount > 1 ? 's are' : ' is'} waiting to sync.</Text></View>}
          </View>
        }
        renderItem={({ item }) => <View style={[styles.sessionRow, { borderBottomColor: colors.border }]}><View style={[styles.sessionIcon, { backgroundColor: colors.accent }]}><Feather name="check" size={16} color={colors.primary} /></View><View style={styles.sessionInfo}><Text style={[styles.sessionPlace, { color: colors.foreground }]}>{item.workplaceName}</Text><Text style={[styles.sessionDate, { color: colors.mutedForeground }]}>{new Date(item.checkInAt).toLocaleDateString()} · {new Date(item.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View><Text style={[styles.sessionDuration, { color: colors.foreground }]}>{item.durationMinutes ? `${item.durationMinutes}m` : 'Active'}</Text></View>}
        ListEmptyComponent={isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : <Text style={[styles.empty, { color: colors.mutedForeground }]}>No attendance sessions yet.</Text>}
        refreshing={isLoading}
        onRefresh={() => void refetch()}
      />
      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View style={styles.scanner}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={handleScan} /><View style={[styles.scannerTop, { paddingTop: insets.top + 12 }]}><Pressable onPress={() => setScannerOpen(false)} style={styles.close}><Ionicons name="close" size={28} color="#fff" /></Pressable><Text style={styles.scannerTitle}>Scan workplace QR</Text></View><View style={styles.scanFrame}><View style={styles.frameCorner} /></View><View style={[styles.scannerBottom, { paddingBottom: insets.bottom + 20 }]}><Text style={styles.scannerHint}>Point your camera at the code displayed at your workplace entrance.</Text></View></View>
      </Modal>
      {processing && <View style={styles.processing}><ActivityIndicator color="#fff" /><Text style={styles.processingText}>Verifying workplace and location…</Text></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.4, marginBottom: 6 },
  greeting: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.5 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  statusCard: { borderRadius: 26, padding: 22, marginBottom: 16, overflow: 'hidden' },
  statusOrb: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#e9fff7', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  statusLabel: { color: '#e9fff7', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  statusPlace: { color: '#bfe8d9', fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  statusTime: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 48, letterSpacing: -2, marginTop: 14 },
  statusHint: { color: '#c6eee0', fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 18 },
  scanButton: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  scanText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  quickCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 13 },
  quickValue: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 13 },
  quickLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  notice: { borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1 },
  sessionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sessionInfo: { flex: 1 },
  sessionPlace: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sessionDate: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  sessionDuration: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  empty: { textAlign: 'center', paddingVertical: 30, fontFamily: 'Inter_400Regular' },
  loader: { paddingVertical: 30 },
  scanner: { flex: 1, backgroundColor: '#000' },
  scannerTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  scannerTitle: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 18 },
  scanFrame: { position: 'absolute', top: '32%', left: '14%', width: '72%', aspectRatio: 1, borderWidth: 2, borderColor: '#fff', borderRadius: 28 },
  frameCorner: { position: 'absolute', top: -3, left: -3, width: 42, height: 42, borderTopWidth: 5, borderLeftWidth: 5, borderColor: '#38d69f', borderTopLeftRadius: 25 },
  scannerBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 42, alignItems: 'center' },
  scannerHint: { color: '#fff', textAlign: 'center', fontFamily: 'Inter_500Medium', lineHeight: 20, fontSize: 14 },
  processing: { position: 'absolute', left: 20, right: 20, bottom: 22, borderRadius: 18, backgroundColor: '#12202a', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  processingText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 13 },
});