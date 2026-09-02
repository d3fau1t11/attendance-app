import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

type Tone = 'info' | 'warning' | 'error' | 'success';

/**
 * Inline status banner.
 *
 * Used for every condition that changes what the app can do — offline, missing
 * permissions, pending sync. Each carries a concrete remedy where one exists,
 * rather than stating a problem the user cannot act on.
 */
export function AlertBanner({
  tone,
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  tone: Tone;
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useColors();

  const palette: Record<Tone, { bg: string; fg: string; accent: string }> = {
    info: { bg: '#e8f1fd', fg: '#1c4a7a', accent: '#2b6cb0' },
    warning: { bg: '#fff4e0', fg: '#7d5011', accent: '#b7791f' },
    error: { bg: '#fdecec', fg: '#8f2b2b', accent: '#c23b3b' },
    success: { bg: colors.accent, fg: colors.accentForeground, accent: colors.primary },
  };

  const { bg, fg, accent } = palette[tone];

  return (
    <View
      style={[styles.banner, { backgroundColor: bg }]}
      accessibilityRole="alert"
    >
      <Feather name={icon} size={17} color={accent} style={styles.icon} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: fg }]}>{title}</Text>
        {message && (
          <Text style={[styles.message, { color: fg }]}>{message}</Text>
        )}
        {actionLabel && onAction && (
          <Pressable onPress={onAction} hitSlop={8} style={styles.action}>
            <Text style={[styles.actionText, { color: accent }]}>
              {actionLabel}
            </Text>
            <Feather name="arrow-right" size={13} color={accent} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 11,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  icon: { marginTop: 1 },
  body: { flex: 1 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 3,
    opacity: 0.9,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 9,
  },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
});
