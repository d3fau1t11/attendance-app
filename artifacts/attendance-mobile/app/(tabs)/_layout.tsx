import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

/**
 * Android-first tab bar.
 *
 * The iOS liquid-glass NativeTabs path from the template was removed: this
 * phase targets Android only, and a second navigator that cannot be tested
 * would be dead weight. Adding it back later is a self-contained change.
 */
export default function TabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
        },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 8,
          height: isWeb ? 84 : 62,
          paddingTop: 6,
        },
        tabBarBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.card },
            ]}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color }) => (
            <Feather name="home" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => (
            <Feather name="calendar" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Feather name="user" size={21} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
