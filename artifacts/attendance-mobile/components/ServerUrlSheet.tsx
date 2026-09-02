import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  getBaseUrl,
  getDefaultBaseUrl,
  setBaseUrlOverride,
} from '@/lib/api/config';
import { pingServer } from '@/lib/api/client';

/**
 * Runtime server-address editor.
 *
 * During development the API runs on a laptop whose LAN IP changes between
 * networks. Without this, every move would mean a rebuild — so the address is
 * editable in-app and verified with a health check before being accepted.
 */
export function ServerUrlSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    void getBaseUrl().then(setValue);
  }, [visible]);

  const save = async () => {
    setTesting(true);
    setResult(null);
    await setBaseUrlOverride(value);
    const reachable = await pingServer();
    setResult(reachable ? 'ok' : 'fail');
    setTesting(false);
    // Leave the sheet open on failure so the address can be corrected.
    if (reachable) setTimeout(onClose, 600);
  };

  const reset = async () => {
    await setBaseUrlOverride(null);
    setValue(getDefaultBaseUrl());
    setResult(null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        <View style={styles.handle} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Server address
        </Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          The address of your attendance API. On a local network this looks like
          http://192.168.1.20:5000
        </Text>

        <TextInput
          style={[
            styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
          value={value}
          onChangeText={(text) => {
            setValue(text);
            setResult(null);
          }}
          placeholder="http://192.168.1.20:5000"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!testing}
        />

        {result === 'ok' && (
          <View style={styles.statusRow}>
            <Feather name="check-circle" size={16} color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.primary }]}>
              Connected successfully
            </Text>
          </View>
        )}
        {result === 'fail' && (
          <View style={styles.statusRow}>
            <Feather name="x-circle" size={16} color={colors.destructive} />
            <Text style={[styles.statusText, { color: colors.destructive }]}>
              Could not reach that address. Check the IP, the port, and that
              your phone is on the same Wi-Fi.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => void save()}
          disabled={testing}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {testing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save and test</Text>
          )}
        </Pressable>

        <Pressable onPress={() => void reset()} style={styles.reset}>
          <Text style={[styles.resetText, { color: colors.mutedForeground }]}>
            Reset to default
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d7e5e0',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
  },
  statusText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  buttonText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 },
  reset: { alignItems: 'center', paddingVertical: 14 },
  resetText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
