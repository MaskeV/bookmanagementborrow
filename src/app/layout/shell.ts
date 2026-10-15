import { Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';
import { Icon, IconName } from '../shared/icon';

interface NavItem { path: string; label: string; icon: IconName; }
interface NavGroup { label: string; items: NavItem[]; }

const SIDEBAR_KEY = 'bookmgmt_sidebar_collapsed';

// The logged-in layout: left sidebar (navigation) + top bar (breadcrumb, theme, user menu) + the page.
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  private auth = inject(AuthService);
  private router = inject(Router);
  theme = inject(ThemeService);

  user = this.auth.session;
  isAdmin = computed(() => this.user()?.role === 'ADMIN');
  displayName = computed(() => this.user()?.name || this.user()?.email || 'User');
  initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  });

  // ----- sidebar navigation: add a page here and it shows up in the sidebar + breadcrumb -----
groups = computed<NavGroup[]>(() => {
  const groups: NavGroup[] = [];

  if (this.isAdmin()) {
    groups.push({
      label: 'Overview',
      items: [{ path: '/dashboard', label: 'Dashboard', icon: 'dashboard' }]
    });
  }

  groups.push({
    label: 'Library',
    items: [{ path: '/books', label: 'Books', icon: 'library' }]
  });

  if (this.isAdmin()) {
    groups.push({
      label: 'Circulation',
      items: [{ path: '/loans', label: 'Loans', icon: 'bookmark' }]
    });
  }

  // Show Account only for regular users
  if (!this.isAdmin()) {
    groups.push({
      label: 'Account',
      items: [{ path: '/profile', label: 'My profile & loans', icon: 'user' }]
    });
  }

  return groups;
});

  // breadcrumb ("Circulation / Loans") worked out from the current URL
  private url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );
  crumb = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    for (const g of this.groups()) {
      const item = g.items.find((i) => path === i.path || path.startsWith(i.path + '/'));
      if (item) return { section: g.label, page: item.label };
    }
    return null;
  });

  // ----- sidebar state -----
  collapsed = signal(this.readCollapsed()); // desktop: icons only
  drawerOpen = signal(false); // mobile: slide-in drawer

  toggleCollapsed() {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // ----- user menu -----
  menuOpen = signal(false);
  private menu = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    // navigating closes the mobile drawer
    effect(() => {
      this.url();
      this.drawerOpen.set(false);
    });
  }

  // close the user menu on outside click, close menu + drawer on Escape
  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(e: MouseEvent) {
    const el = this.menu()?.nativeElement;
    if (el && !el.contains(e.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuOpen.set(false);
    this.drawerOpen.set(false);
  }

  logout() {
    this.menuOpen.set(false);
    this.auth.logout();
  }

  private readCollapsed(): boolean {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  }
}
