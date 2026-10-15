import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const KEY = 'bookmgmt_theme';

// Light / dark theme. Remembered in localStorage; until the user picks one it follows the OS setting.
// The theme is applied as <html data-theme="..."> and styles.css does the rest with CSS variables.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private doc = inject(DOCUMENT);

  readonly theme = signal<Theme>(this.initial());
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.doc.documentElement.setAttribute('data-theme', theme);
      this.doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#f4f5fa');
    });

    // follow the OS while the user has not chosen a theme themselves
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!this.stored()) this.theme.set(e.matches ? 'dark' : 'light');
    });
  }

  toggle() {
    const next: Theme = this.isDark() ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice just lasts for this visit */
    }
    this.theme.set(next);
  }

  private stored(): Theme | null {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  private initial(): Theme {
    return this.stored() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
}
