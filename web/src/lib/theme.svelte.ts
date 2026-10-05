/** Visual themes. All three share one token contract (see app.css); they
 *  differ in surface tint and accent only — the data colors (download,
 *  upload, status) are fixed across themes because they carry meaning. */
export const THEMES = ['graphite', 'arctic', 'ember'] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  graphite: 'Graphite',
  arctic: 'Arctic',
  ember: 'Ember',
};

// Bumped so kiosks holding a retired theme name fall back to the default.
const STORAGE_KEY = 'panel.theme.v4';
const DEFAULT_THEME: ThemeName = 'graphite';

function isTheme(v: string | null | undefined): v is ThemeName {
  return !!v && (THEMES as readonly string[]).includes(v);
}

function readInitial(): ThemeName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('theme');
  if (isTheme(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // localStorage may not be available
  }
  return DEFAULT_THEME;
}

class ThemeStore {
  current = $state<ThemeName>(DEFAULT_THEME);
  changedAt = $state(0);

  init(): () => void {
    this.current = readInitial();
    this.apply();
    const handler = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }

  set(name: ThemeName): void {
    if (this.current === name) return;
    this.current = name;
    this.changedAt = Date.now();
    this.apply();
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // ignore
    }
  }

  cycle(dir = 1): void {
    const idx = THEMES.indexOf(this.current);
    const next = THEMES[(idx + dir + THEMES.length) % THEMES.length]!;
    this.set(next);
  }

  private apply(): void {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = this.current;
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.matches('input, textarea, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      this.cycle(e.shiftKey ? -1 : 1);
    }
  }
}

export const theme = new ThemeStore();

/** Read a CSS custom property from :root. Re-read whenever the theme changes. */
export function cssVar(name: string, fallback = '#ffffff'): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
