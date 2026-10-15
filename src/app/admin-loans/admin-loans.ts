import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Loan } from '../models/loan';
import { LoanService } from '../services/loan.service';
import { Icon, IconName } from '../shared/icon';
import { tagStyle } from '../shared/tag-style';
import { ToastService } from '../shared/toast.service';

type StatusTab = 'all' | 'active' | 'dueSoon' | 'overdue' | 'returned';
type DateField = 'borrowedAt' | 'dueDate' | 'returnedAt';
type Preset = 'all' | 'today' | '7' | '15' | '30' | '90' | 'thisMonth' | 'lastMonth' | 'next7' | 'custom';
type SortKey = 'borrower' | 'book' | 'borrowedAt' | 'dueDate' | 'returnedAt' | 'status';
type SortDir = 'asc' | 'desc';

const DUE_SOON_DAYS = 3; // "Due soon" = not returned and due within the next 3 days

// ---------- date helpers (everything is compared as a whole day, in the browser's time zone) ----------
// "2026-10-27" or "2026-10-13T10:15:30"  ->  midnight of that day (ms), or null
function dayOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function addDays(day: number, n: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
const daysBetween = (a: number, b: number) => Math.round((a - b) / 86_400_000);
const fmtDay = (ms: number, year = false) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });

// Admin only: every loan of every user - who borrowed which book, when it is due, and whether it came back.
@Component({
  selector: 'app-admin-loans',
  imports: [DatePipe, FormsModule, Icon],
  templateUrl: './admin-loans.html',
  styleUrl: './admin-loans.css',
})
export class AdminLoans implements OnInit {
  private api = inject(LoanService);
  private toast = inject(ToastService);
  tagStyle = tagStyle;

  // ---------- data ----------
  loans = signal<Loan[]>([]);
  loading = signal(false);
  loaded = signal(false);
  failed = signal(false);
  updatedAt = signal<Date | null>(null);
  now = signal(Date.now()); // refreshed on every load, so "overdue by N days" stays correct

  // ---------- filter state ----------
  search = signal('');
  status = signal<StatusTab>('all');
  dateField = signal<DateField>('borrowedAt');
  preset = signal<Preset>('all');
  customFrom = signal(''); // yyyy-mm-dd (from <input type="date">)
  customTo = signal('');
  category = signal('');
  borrower = signal(''); // borrower's e-mail
  minOverdue = signal(0); // only loans overdue by at least N days
  moreOpen = signal(false);

  // ---------- sorting + paging ----------
  sortKey = signal<SortKey>('borrowedAt');
  sortDir = signal<SortDir>('desc');
  pageSize = signal(10);
  page = signal(1);

  // ---------- static option lists ----------
  presets: { id: Preset; label: string }[] = [
    { id: 'all', label: 'All time' },
    { id: 'today', label: 'Today' },
    { id: '7', label: 'Last 7 days' },
    { id: '15', label: 'Last 15 days' },
    { id: '30', label: 'Last 30 days' },
    { id: '90', label: 'Last 90 days' },
    { id: 'thisMonth', label: 'This month' },
    { id: 'lastMonth', label: 'Last month' },
    { id: 'next7', label: 'Next 7 days' },
    { id: 'custom', label: 'Custom' },
  ];
  columns: { key: SortKey; label: string }[] = [
    { key: 'borrower', label: 'Borrower' },
    { key: 'book', label: 'Book' },
    { key: 'borrowedAt', label: 'Borrowed on' },
    { key: 'dueDate', label: 'Due date' },
    { key: 'returnedAt', label: 'Returned on' },
    { key: 'status', label: 'Status' },
  ];
  overdueOptions = [
    { value: 0, label: 'Any' },
    { value: 1, label: '1+ days' },
    { value: 7, label: '7+ days' },
    { value: 14, label: '14+ days' },
    { value: 30, label: '30+ days' },
  ];
  pageSizes = [10, 25, 50, 100];
  private fieldLabels: Record<DateField, string> = { borrowedAt: 'Borrowed', dueDate: 'Due', returnedAt: 'Returned' };
  fieldLabel = computed(() => this.fieldLabels[this.dateField()]);

  // ---------- derived lists for the dropdowns ----------
  categories = computed(() => [...new Set(this.loans().map((l) => l.category).filter(Boolean))].sort());
  borrowers = computed(() => {
    const byEmail = new Map<string, string>();
    for (const l of this.loans()) byEmail.set(l.userEmail, l.userName);
    return [...byEmail].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  // ---------- the date range the user picked ----------
  range = computed<{ from: number | null; to: number | null; invalid: boolean }>(() => {
    const today = this.startOfToday();
    const none = { from: null, to: null, invalid: false };
    const d = new Date(today);
    switch (this.preset()) {
      case 'today': return { from: today, to: today, invalid: false };
      case '7': return { from: addDays(today, -6), to: today, invalid: false };
      case '15': return { from: addDays(today, -14), to: today, invalid: false };
      case '30': return { from: addDays(today, -29), to: today, invalid: false };
      case '90': return { from: addDays(today, -89), to: today, invalid: false };
      case 'thisMonth':
        return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(), invalid: false };
      case 'lastMonth':
        return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 0).getTime(), invalid: false };
      case 'next7': return { from: today, to: addDays(today, 7), invalid: false };
      case 'custom': {
        const from = dayOf(this.customFrom());
        const to = dayOf(this.customTo());
        return { from, to, invalid: from !== null && to !== null && from > to };
      }
      default: return none;
    }
  });
  // "9 Oct – 15 Oct 2026"
  rangeText = computed(() => {
    const { from, to } = this.range();
    if (from === null && to === null) return '';
    if (from !== null && to !== null) return from === to ? fmtDay(from, true) : `${fmtDay(from)} – ${fmtDay(to, true)}`;
    return from !== null ? `from ${fmtDay(from, true)}` : `until ${fmtDay(to!, true)}`;
  });

  // ---------- filtering ----------
  // Everything except the status tab. The stat cards and the tab counts are based on this list.
  scoped = computed(() => {
    const q = this.search().trim().toLowerCase();
    const { from, to, invalid } = this.range();
    const field = this.dateField();
    const category = this.category();
    const borrower = this.borrower();
    const minOverdue = this.minOverdue();
    const now = this.now();

    return this.loans().filter((l) => {
      if (q && ![l.userName, l.userEmail, l.title, l.author, l.category].some((v) => (v ?? '').toLowerCase().includes(q))) return false;
      if (category && l.category !== category) return false;
      if (borrower && l.userEmail !== borrower) return false;
      if (minOverdue > 0 && !(this.isOverdue(l) && this.overdueDays(l, now) >= minOverdue)) return false;
      if (!invalid && (from !== null || to !== null)) {
        const day = dayOf(l[field]);
        if (day === null) return false; // e.g. filtering "Returned on" hides loans that are not returned yet
        if (from !== null && day < from) return false;
        if (to !== null && day > to) return false;
      }
      return true;
    });
  });

  active = computed(() => this.scoped().filter((l) => !l.returnedAt));
  overdue = computed(() => this.scoped().filter((l) => this.isOverdue(l)));
  dueSoon = computed(() => this.scoped().filter((l) => this.isDueSoon(l, this.now())));
  returned = computed(() => this.scoped().filter((l) => !!l.returnedAt));

  tabs = computed(() => [
    { id: 'all' as StatusTab, label: 'All', count: this.scoped().length },
    { id: 'active' as StatusTab, label: 'Borrowed', count: this.active().length },
    { id: 'dueSoon' as StatusTab, label: 'Due soon', count: this.dueSoon().length },
    { id: 'overdue' as StatusTab, label: 'Overdue', count: this.overdue().length },
    { id: 'returned' as StatusTab, label: 'Returned', count: this.returned().length },
  ]);

  // stat cards
  longestOverdue = computed(() => Math.max(0, ...this.overdue().map((l) => this.overdueDays(l, this.now()))));
  returnRate = computed(() => (this.scoped().length ? Math.round((this.returned().length / this.scoped().length) * 100) : 0));

  // ---------- sorted + paged rows ----------
  sorted = computed(() => {
    const list =
      this.status() === 'active' ? this.active()
      : this.status() === 'dueSoon' ? this.dueSoon()
      : this.status() === 'overdue' ? this.overdue()
      : this.status() === 'returned' ? this.returned()
      : this.scoped();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    const rank = { OVERDUE: 0, BORROWED: 1, RETURNED: 2 };
    const text = (a: string, b: string) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });

    return [...list].sort((a, b) => {
      let r = 0;
      if (key === 'borrower') r = text(a.userName, b.userName);
      else if (key === 'book') r = text(a.title, b.title);
      else if (key === 'status') r = rank[a.status] - rank[b.status];
      else if (key === 'returnedAt') {
        // loans that are not returned always go to the bottom, whatever the direction
        if (!a.returnedAt || !b.returnedAt) return a.returnedAt ? -1 : b.returnedAt ? 1 : b.id - a.id;
        r = a.returnedAt.localeCompare(b.returnedAt);
      } else r = a[key].localeCompare(b[key]); // ISO strings sort correctly as text
      return r * dir || b.id - a.id;
    });
  });

  total = computed(() => this.sorted().length);
  pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  current = computed(() => Math.min(this.page(), this.pageCount()));
  rows = computed(() => this.sorted().slice((this.current() - 1) * this.pageSize(), this.current() * this.pageSize()));
  fromRow = computed(() => (this.total() ? (this.current() - 1) * this.pageSize() + 1 : 0));
  toRow = computed(() => Math.min(this.current() * this.pageSize(), this.total()));
  // 1 … 4 5 [6] 7 8 … 20
  pages = computed<(number | '…')[]>(() => {
    const last = this.pageCount();
    const cur = this.current();
    const out: (number | '…')[] = [];
    for (let p = 1; p <= last; p++) {
      if (p === 1 || p === last || Math.abs(p - cur) <= 1) out.push(p);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  });

  // ---------- active filter chips ----------
  extraCount = computed(() => (this.category() ? 1 : 0) + (this.borrower() ? 1 : 0) + (this.minOverdue() ? 1 : 0));
  chips = computed(() => {
    const out: { key: string; label: string }[] = [];
    const q = this.search().trim();
    if (q) out.push({ key: 'search', label: `Search: “${q}”` });
    if (this.preset() !== 'all' && (this.preset() !== 'custom' || this.rangeText())) {
      const name = this.preset() === 'custom' ? '' : this.presets.find((p) => p.id === this.preset())?.label + ' · ';
      out.push({ key: 'range', label: `${this.fieldLabel()}: ${name ?? ''}${this.rangeText()}` });
    }
    if (this.category()) out.push({ key: 'category', label: `Category: ${this.category()}` });
    if (this.borrower()) out.push({ key: 'borrower', label: `Borrower: ${this.borrowers().find((b) => b.email === this.borrower())?.name ?? this.borrower()}` });
    if (this.minOverdue()) out.push({ key: 'overdue', label: `Overdue ${this.minOverdue()}+ days` });
    return out;
  });

  ngOnInit() {
    this.load();
  }

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.failed.set(false);
    this.api.allLoans().subscribe({
      next: (list) => {
        this.loans.set(list);
        this.now.set(Date.now());
        this.updatedAt.set(new Date());
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  // ---------- filter actions (every change goes back to page 1) ----------
  setSearch(v: string) { this.search.set(v); this.page.set(1); }
  setStatus(v: StatusTab) { this.status.set(v); this.page.set(1); }
  setDateField(v: DateField) { this.dateField.set(v); this.page.set(1); }
  setPreset(v: Preset) { this.preset.set(v); this.page.set(1); }
  setCustom(which: 'from' | 'to', v: string) { (which === 'from' ? this.customFrom : this.customTo).set(v); this.page.set(1); }
  setCategory(v: string) { this.category.set(v); this.page.set(1); }
  setBorrower(v: string) { this.borrower.set(v); this.page.set(1); }
  setMinOverdue(v: number) { this.minOverdue.set(+v); this.page.set(1); }
  setPageSize(v: number) { this.pageSize.set(+v); this.page.set(1); }
  goto(p: number) { this.page.set(Math.min(Math.max(1, p), this.pageCount())); }

  removeChip(key: string) {
    if (key === 'search') this.search.set('');
    else if (key === 'range') { this.preset.set('all'); this.customFrom.set(''); this.customTo.set(''); }
    else if (key === 'category') this.category.set('');
    else if (key === 'borrower') this.borrower.set('');
    else if (key === 'overdue') this.minOverdue.set(0);
    this.page.set(1);
  }

  clearAll() {
    this.search.set('');
    this.status.set('all');
    this.preset.set('all');
    this.customFrom.set('');
    this.customTo.set('');
    this.category.set('');
    this.borrower.set('');
    this.minOverdue.set(0);
    this.page.set(1);
  }

  // ---------- sorting ----------
  sortBy(key: SortKey) {
    if (this.sortKey() === key) this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'borrower' || key === 'book' || key === 'status' ? 'asc' : 'desc'); // newest dates first
    }
    this.page.set(1);
  }
  sortIcon(key: SortKey): IconName {
    return this.sortKey() !== key ? 'sort' : this.sortDir() === 'asc' ? 'arrowUp' : 'arrowDown';
  }
  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() !== key ? 'none' : this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  // ---------- loan helpers used by the template ----------
  initials(name: string): string {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  isOverdue(l: Loan): boolean {
    return !l.returnedAt && l.status === 'OVERDUE';
  }

  isDueSoon(l: Loan, now: number): boolean {
    if (l.returnedAt || l.status === 'OVERDUE') return false;
    const due = dayOf(l.dueDate);
    if (due === null) return false;
    const days = daysBetween(due, this.startOfDay(now));
    return days >= 0 && days <= DUE_SOON_DAYS;
  }

  overdueDays(l: Loan, now: number): number {
    const due = dayOf(l.dueDate);
    if (due === null) return 0;
    return Math.max(0, daysBetween(this.startOfDay(now), due));
  }

  // "Due in 3 days" / "Due today" / "2 days overdue"
  dueText(l: Loan): string {
    const due = dayOf(l.dueDate);
    if (due === null) return '';
    const days = daysBetween(due, this.startOfDay(this.now()));
    if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} overdue`;
    if (days === 0) return 'Due today';
    return `Due in ${days} ${days === 1 ? 'day' : 'days'}`;
  }

  // returned loans: "Returned 2 days late" (nothing when it came back on time)
  lateText(l: Loan): string {
    const due = dayOf(l.dueDate);
    const back = dayOf(l.returnedAt);
    if (due === null || back === null || back <= due) return '';
    const days = daysBetween(back, due);
    return `${days} ${days === 1 ? 'day' : 'days'} late`;
  }

  statusLabel(l: Loan): string {
    return l.status === 'BORROWED' ? 'Borrowed' : l.status === 'OVERDUE' ? 'Overdue' : 'Returned';
  }

  // ---------- export ----------
  // Downloads everything that matches the current filters (all pages), ready to open in Excel.
  exportCsv() {
    const list = this.sorted();
    if (!list.length) return;
    const safe = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops Excel from running a name like "=SUM(...)" as a formula
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Borrower', 'Email', 'Book', 'Author', 'Category', 'Borrowed on', 'Due date', 'Returned on', 'Status'],
      ...list.map((l) => [l.userName, l.userEmail, l.title, l.author, l.category, l.borrowedAt.replace('T', ' ').slice(0, 16), l.dueDate, (l.returnedAt ?? '').replace('T', ' ').slice(0, 16), this.statusLabel(l)]),
    ].map((row) => row.map(safe).join(','));

    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loans-${new Date().toLocaleDateString('en-CA')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success(`Exported ${list.length} ${list.length === 1 ? 'loan' : 'loans'} to CSV.`);
  }

  private startOfDay(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  private startOfToday(): number {
    return this.startOfDay(this.now());
  }
}
