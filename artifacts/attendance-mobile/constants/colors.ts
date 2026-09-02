/**
 * Semantic design tokens for the mobile app.
 *
 * Light & Dark theme color palettes with cohesive modern styling.
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#12202a',
    tint: '#18b887',

    // Core surfaces
    background: '#f4f8f7',
    foreground: '#12202a',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#12202a',

    // Primary action color (buttons, links, active states)
    primary: '#0f8f6b',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e5f2ee',
    secondaryForeground: '#155544',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#e8f0ee',
    mutedForeground: '#6b7c78',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#d4f5e9',
    accentForeground: '#0d634c',

    // Destructive actions (delete, error states)
    destructive: '#d45151',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#d7e5e0',
    input: '#c8dbd4',
  },

  dark: {
    // Legacy aliases
    text: '#f0f6fc',
    tint: '#2dd4bf',

    // Core surfaces
    background: '#0d1117',
    foreground: '#f0f6fc',

    // Cards / elevated surfaces
    card: '#161b22',
    cardForeground: '#f0f6fc',

    // Primary action color
    primary: '#14b8a6',
    primaryForeground: '#0d1117',

    // Secondary surfaces
    secondary: '#1c2128',
    secondaryForeground: '#2dd4bf',

    // Muted elements
    muted: '#21262d',
    mutedForeground: '#8b949e',

    // Accent highlights
    accent: '#1e3a34',
    accentForeground: '#2dd4bf',

    // Destructive actions
    destructive: '#f85149',
    destructiveForeground: '#ffffff',

    // Borders and inputs
    border: '#30363d',
    input: '#30363d',
  },

  radius: 8,
};

export default colors;
