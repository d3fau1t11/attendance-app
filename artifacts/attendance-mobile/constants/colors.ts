/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
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

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
