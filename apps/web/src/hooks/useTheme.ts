import { useCallback, useEffect, useState } from 'react';
import { useMediaQuery } from './useMedia';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'ss-theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // storage blocked (private mode): fall back to the OS preference
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = choice === 'dark' || (choice === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Preference simply won't persist; the theme still applies for this visit.
    }
  }, []);

  return { choice, dark, set, toggle: () => set(dark ? 'light' : 'dark') };
}
