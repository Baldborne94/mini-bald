import { useCallback, useEffect, useState } from 'react';

export interface Theme {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  blurb: string;
  /** Preview colours: background, surface, then the loudest paints. */
  swatches: string[];
}

export const THEMES: Theme[] = [
  { id: 'midnight', name: 'Night Shift', mode: 'dark', blurb: 'Ink violet, hot magenta, cyan', swatches: ['#14101f', '#201932', '#ff3d8b', '#2ee6d6', '#ffb020', '#a6f04b'] },
  { id: 'forge', name: 'Forge', mode: 'dark', blurb: 'Charcoal, ember orange, brass', swatches: ['#15120f', '#221d18', '#ff6a1f', '#ffd23f', '#5ec2b7', '#9be564'] },
  { id: 'palette', name: 'Wet Palette', mode: 'light', blurb: 'Cream paper, cobalt, vermilion', swatches: ['#fbf3e4', '#fffdf8', '#2b3fe0', '#f0432c', '#f2b01e', '#12a594'] },
  { id: 'pop', name: 'Pop Primer', mode: 'light', blurb: 'White, black outlines, violet, lime', swatches: ['#fffef5', '#ffffff', '#6b2bff', '#c6ff3d', '#ff3ea5', '#1fb6ff'] },
];

const KEY = 'minibald.theme';

/** The theme is a per-device preference (phone dark, desktop light…), so it lives in localStorage. */
export function useTheme() {
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme ?? 'midnight');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = THEMES.find((t) => t.id === theme)?.swatches[0];
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme]);

  const setTheme = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode: the theme still applies for this visit */
    }
    setThemeState(id);
  }, []);

  return { theme, setTheme };
}
