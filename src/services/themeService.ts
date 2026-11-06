// ==============================================================================
// Theme Preference & Local Storage Service
// Manages Basedash Midnight Dark / Light theme preferences, first-time user
// onboarding prompt flags, and automatic preference recall on app load.
// ==============================================================================

export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'uc_dashboard_theme';
export const THEME_PREFERENCE_SET_KEY = 'uc_theme_preference_set';

/**
 * Retrieves the currently saved theme preference, defaulting to 'dark' (Midnight).
 */
export function getStoredTheme(): ThemeMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    }
  } catch {
    // ignore storage access errors
  }
  return 'dark'; // Midnight Dark by default
}

/**
 * Checks if the user (or current browser) has previously selected and saved a theme preference.
 */
export function hasUserSavedThemePreference(userId?: string): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (userId && window.localStorage.getItem(`${THEME_PREFERENCE_SET_KEY}_${userId}`) === 'true') {
        return true;
      }
      return window.localStorage.getItem(THEME_PREFERENCE_SET_KEY) === 'true';
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Persists the user's theme preference locally in localStorage and updates the DOM data-theme.
 */
export function saveThemePreference(theme: ThemeMode, userId?: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      window.localStorage.setItem(THEME_PREFERENCE_SET_KEY, 'true');
      if (userId) {
        window.localStorage.setItem(`${THEME_PREFERENCE_SET_KEY}_${userId}`, 'true');
      }
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch {
    // ignore storage access errors
  }
}
