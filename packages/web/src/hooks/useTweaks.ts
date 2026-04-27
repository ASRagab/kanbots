import { useCallback, useEffect, useState } from 'react';

export interface Tweaks {
  theme: 'dark' | 'paper';
  accentHue: number;
  showRail: boolean;
  showTray: boolean;
}

export const TWEAK_DEFAULTS: Tweaks = {
  theme: 'dark',
  accentHue: 45,
  showRail: true,
  showTray: true,
};

const STORAGE_KEY = 'kanbots:tweaks';

function readTweaks(): Tweaks {
  if (typeof window === 'undefined') return TWEAK_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return TWEAK_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Tweaks>;
    return { ...TWEAK_DEFAULTS, ...parsed };
  } catch {
    return TWEAK_DEFAULTS;
  }
}

function writeTweaks(t: Tweaks): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // ignore quota / disabled storage
  }
}

function applyTheme(t: Tweaks): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', t.theme);
  const lightness = t.theme === 'paper' ? '0.585' : '0.745';
  document.documentElement.style.setProperty(
    '--accent',
    `oklch(${lightness} 0.155 ${t.accentHue})`,
  );
  document.documentElement.style.setProperty(
    '--accent-line',
    `oklch(${lightness} 0.155 ${t.accentHue} / 0.45)`,
  );
  document.documentElement.style.setProperty(
    '--accent-soft',
    `oklch(${lightness} 0.155 ${t.accentHue} / 0.14)`,
  );
  document.documentElement.style.setProperty(
    '--running',
    `oklch(${lightness} 0.155 ${t.accentHue})`,
  );
}

export function useTweaks(): {
  tweaks: Tweaks;
  set: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  reset: () => void;
} {
  const [tweaks, setTweaks] = useState<Tweaks>(() => readTweaks());

  useEffect(() => {
    applyTheme(tweaks);
    writeTweaks(tweaks);
  }, [tweaks]);

  const set = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setTweaks(TWEAK_DEFAULTS), []);

  return { tweaks, set, reset };
}
