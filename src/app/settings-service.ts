import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  theme: ThemeMode;
  taxRate: number;        // porcentaje, ej. 8.25
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  taxRate: 8.25,
  reduceMotion: false,
};

const STORAGE_KEY = 'marketplus-settings';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  // Acceso seguro: no falla en tests, SSR ni entornos sin matchMedia
  private readonly media: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  private readonly systemDark = signal<boolean>(this.media?.matches ?? false);

  readonly settings = signal<AppSettings>(this.load());
  readonly TaxNumber = signal<number>(DEFAULT_SETTINGS.taxRate);

  /** Tema real que se está mostrando (resuelve "system"). */
  readonly resolvedTheme = computed<'light' | 'dark'>(() => {
    const t = this.settings().theme;
    return t === 'system' ? (this.systemDark() ? 'dark' : 'light') : t;
  });

  constructor() {
    // Si el usuario cambia el tema del sistema en vivo
    this.media?.addEventListener('change', e => this.systemDark.set(e.matches));

    // Aplica el tema al <html>: <html data-theme="dark" data-motion="reduced">
    effect(() => {
      const theme = this.resolvedTheme();
      const reduced = this.settings().reduceMotion;
      if (typeof document === 'undefined') return;

      const root = document.documentElement;
      root.dataset['theme'] = theme;
      root.style.colorScheme = theme;   // scrollbars e inputs nativos
      root.dataset['motion'] = reduced ? 'reduced' : 'full';
    });

    // Persiste cada cambio
    effect(() => {
      const value = JSON.stringify(this.settings());
      try {
        localStorage.setItem(STORAGE_KEY, value);
        this.TaxNumber.set(this.settings().taxRate);
      } catch { /* almacenamiento no disponible */ }
    });
  }

  update(patch: Partial<AppSettings>): void {
    this.settings.update(s => ({ ...s, ...patch }));
  }

  reset(): void {
    this.settings.set({ ...DEFAULT_SETTINGS });
  }

  load(): AppSettings {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (!raw) return { ...DEFAULT_SETTINGS };
      return {
        theme: ['light', 'dark', 'system'].includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
        taxRate: typeof raw.taxRate === 'number' && raw.taxRate >= 0 && raw.taxRate <= 30
          ? raw.taxRate : DEFAULT_SETTINGS.taxRate,
        reduceMotion: raw.reduceMotion === true,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}