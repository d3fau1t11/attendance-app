import { useColorScheme as useDeviceColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { useTheme } from '@/lib/theme/ThemeContext';

/**
 * Returns the design tokens for the active color scheme.
 *
 * Automatically respects the ThemeProvider setting (Light, Dark, System).
 */
export function useColors() {
  try {
    const theme = useTheme();
    return theme.colors;
  } catch {
    const scheme = useDeviceColorScheme();
    const palette = scheme === 'dark' ? colors.dark : colors.light;
    return { ...palette, radius: colors.radius };
  }
}
