import { beforeEach, describe, expect, it } from 'vitest';

// Polyfill window.localStorage for Node test environment if missing
if (typeof window === 'undefined') {
  const store: Record<string, string> = {};
  (global as unknown as { window: Record<string, unknown> }).window = {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) {
          delete store[k];
        }
      },
    },
  };
}

import {
  THEME_STORAGE_KEY,
  THEME_PREFERENCE_SET_KEY,
  getStoredTheme,
  hasUserSavedThemePreference,
  saveThemePreference,
} from '../../src/services/themeService';

describe('Theme Preference & First-Time Login Onboarding Suite', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to midnight dark theme when no preference is saved', () => {
    expect(getStoredTheme()).toBe('dark');
  });

  it('autopicks saved preference from localStorage on subsequent sessions', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(getStoredTheme()).toBe('light');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredTheme()).toBe('dark');
  });

  it('gracefully falls back to dark if invalid theme string is stored', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid_theme');
    expect(getStoredTheme()).toBe('dark');
  });

  it('identifies first-time login when theme preference has not been set', () => {
    expect(hasUserSavedThemePreference()).toBe(false);
    expect(hasUserSavedThemePreference('user-123')).toBe(false);
  });

  it('saves theme preference locally and marks preference as configured', () => {
    saveThemePreference('light', 'user-456');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(window.localStorage.getItem(THEME_PREFERENCE_SET_KEY)).toBe('true');
    expect(window.localStorage.getItem(`${THEME_PREFERENCE_SET_KEY}_user-456`)).toBe('true');

    expect(hasUserSavedThemePreference('user-456')).toBe(true);
    expect(getStoredTheme()).toBe('light');
  });

  it('allows user to switch between midnight and light and updates preference', () => {
    // 1. First set light
    saveThemePreference('light', 'user-789');
    expect(getStoredTheme()).toBe('light');

    // 2. Switch to midnight dark
    saveThemePreference('dark', 'user-789');
    expect(getStoredTheme()).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
