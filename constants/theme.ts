/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export type AppTheme = {
  isDark: boolean;
  gradient: string[];
  background: string;
  overlay: string;
  surface: string;
  surfaceSecondary: string;
  cardBackground: string;
  cardBorder: string;
  cardShadow: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverted: string;
  accent: string;
  accentSoft: string;
  gold: string;
  goldSoft: string;
  goldBorder: string;
  teal: string;
  blue: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  inputBackground: string;
  inputBorder: string;
  placeholder: string;
  tagBackground: string;
  fabBackground: string;
  fabShadow: string;
  modalBackground: string;
  divider: string;
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
} as const;

export const Radii = {
  sm: 8,
  md: 12,
  card: 18,
  large: 22,
  pill: 999,
} as const;

export const getThemeConfig = (isDark: boolean): AppTheme => {
  if (isDark) {
    return {
      isDark: true,
      gradient: ['#0B1020', '#10172A', '#0B1020'],
      background: '#0B1020',
      overlay: 'rgba(5, 8, 16, 0.75)',
      surface: '#151D32',
      surfaceSecondary: '#1B243B',
      cardBackground: '#151D32',
      cardBorder: 'rgba(214, 179, 106, 0.16)',
      cardShadow: '#050811',
      textPrimary: '#F7F3EA',
      textSecondary: '#A9B0BF',
      textMuted: '#747E93',
      textInverted: '#0B1020',
      accent: '#D6B36A', // Champagne Gold
      accentSoft: 'rgba(214, 179, 106, 0.14)',
      gold: '#D6B36A',
      goldSoft: '#E5C98A',
      goldBorder: 'rgba(214, 179, 106, 0.28)',
      teal: '#35C6A3',
      blue: '#4F7CFF',
      success: '#34D399',
      danger: '#E06A6A',
      warning: '#E5C98A',
      info: '#4F7CFF',
      inputBackground: '#10172A',
      inputBorder: 'rgba(214, 179, 106, 0.20)',
      placeholder: '#626C80',
      tagBackground: '#1B243B',
      fabBackground: '#D6B36A',
      fabShadow: '#050811',
      modalBackground: '#151D32',
      divider: 'rgba(214, 179, 106, 0.12)',
    };
  }

  return {
    isDark: false,
    gradient: ['#FBF9F5', '#F5EFE6', '#FBF9F5'],
    background: '#FBF9F5',
    overlay: 'rgba(11, 16, 32, 0.40)',
    surface: '#FFFFFF',
    surfaceSecondary: '#F5EFE6',
    cardBackground: '#FFFFFF',
    cardBorder: 'rgba(184, 141, 59, 0.22)',
    cardShadow: 'rgba(11, 16, 32, 0.06)',
    textPrimary: '#0B1020',
    textSecondary: '#4A5568',
    textMuted: '#768294',
    textInverted: '#FFFFFF',
    accent: '#B88D3B', // Antique Champagne Gold for high contrast
    accentSoft: 'rgba(184, 141, 59, 0.12)',
    gold: '#B88D3B',
    goldSoft: '#D6B36A',
    goldBorder: 'rgba(184, 141, 59, 0.32)',
    teal: '#269A7E',
    blue: '#3462DE',
    success: '#28A745',
    danger: '#D9534F',
    warning: '#C69224',
    info: '#3462DE',
    inputBackground: '#F5EFE6',
    inputBorder: 'rgba(184, 141, 59, 0.28)',
    placeholder: '#8490A2',
    tagBackground: '#EFE9DC',
    fabBackground: '#B88D3B',
    fabShadow: 'rgba(11, 16, 32, 0.12)',
    modalBackground: '#FFFFFF',
    divider: 'rgba(184, 141, 59, 0.14)',
  };
};

/**
 * Light/dark color map used by _layout.tsx and themed components.
 */
export const Colors = {
  light: {
    tint: "#B88D3B",
    background: "#FBF9F5",
    text: "#0B1020",
    icon: "#768294",
    tabIconDefault: "#768294",
    tabIconSelected: "#B88D3B",
  },
  dark: {
    tint: "#D6B36A",
    background: "#0B1020",
    text: "#F7F3EA",
    icon: "#747E93",
    tabIconDefault: "#747E93",
    tabIconSelected: "#D6B36A",
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});