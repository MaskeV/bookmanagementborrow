import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, finalize, map, of, switchMap, tap } from 'rxjs';
import { Book, BookFilters, BookQuery, Page } from '../models/book';
import { AuthService } from '../services/auth.service';
import { BookService } from '../services/book.service';
import { BookStore } from '../services/book.store';
import { LoanStore } from '../services/loan.store';
import { Icon, IconName } from '../shared/icon';
import { tagStyle } from '../shared/tag-style';
import { ToastService } from '../shared/toast.service';

// the column names the backend accepts in ?sort=
type SortKey = 'title' | 'category' | 'language' | 'publicationYear' | 'quantity' | 'available';
type SortDir = 'asc' | 'desc';

const emptyFilters: BookFilters = { category: '', language: '', publisher: '', available: '' };

function matchScore(text: string | undefined, q: string): number {
  const t = (text ?? '').toLowerCase();
  if (!t || !q) return 9;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/[\s,.\-_/]+/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  return 9;
}

@Component({
  selector: 'app-book-manager',
  imports: [FormsModule, RouterLink, RouterOutlet, Icon],
  templateUrl: './book-manager.html',
  styleUrl: './book-manager.css',
})
export class BookManager implements OnInit {
  private auth = inject(AuthService);
  private bookService = inject(BookService);
  private toast = inject(ToastService);
  store = inject(BookStore);
  loans = inject(LoanStore);
  tagStyle = tagStyle;

  
  canEdit = computed(() => this.auth.session()?.role === 'ADMIN');

 
  search = signal(''); 
  query = signal(''); 
  filters = signal<BookFilters>({ ...emptyFilters });
  sort = signal<{ key: SortKey | null; dir: SortDir }>({ key: null, dir: 'asc' });
  pageSize = signal(10);
  page = signal(1); 
  readonly pageSizes = [10, 25, 50];

  // ---------- what came back ----------
  result = signal<Page<Book> | null>(null);
  loading = signal(false);
  failed = signal(false);

  // suggestion list state (the list itself is built from the table rows, see below)
  showSuggestions = signal(false);
  activeIndex = signal(-1);

  // delete confirmation
  deleteTarget = signal<Book | null>(null);
  deleting = signal(false);

  categories = computed(() => this.store.options().categories);
  languages = computed(() => this.store.options().languages);
  publishers = computed(() => this.store.options().publishers);
  hasFilters = computed(() => Object.values(this.filters()).some(Boolean));

  rows = computed(() => this.result()?.content ?? []);

  // While searching, the closest matches (title or author starting with the typed text, e.g. "John")
  // go to the top. If the user clicked a column to sort, that order wins.
  rankedRows = computed(() => {
    const q = this.query().toLowerCase();
    const rows = this.rows();
    if (!q || this.sort().key) return rows;
    const score = (b: Book) => Math.min(matchScore(b.title, q), matchScore(b.author, q));
    return rows
      .map((book, i) => ({ book, i, s: score(book) }))
      .sort((a, b) => a.s - b.s || a.i - b.i) // equal score keeps the server's order
      .map((x) => x.book);
  });

  // Suggestions under the search box. No extra API call: they are built from the rows the table
  // already loaded for this search, closest match first.
  suggestions = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return [];
    const unique = new Set<string>();
    this.rankedRows().forEach((b) =>
      [b.title, b.author].forEach((v) => {
        if (v && v.toLowerCase().includes(q)) unique.add(v);
      })
    );
    return [...unique].sort((a, b) => matchScore(a, q) - matchScore(b, q)).slice(0, 8);
  });

  total = computed(() => this.result()?.totalElements ?? 0);
  totalPages = computed(() => Math.max(1, this.result()?.totalPages ?? 1));
  rangeStart = computed(() => (this.total() ? (this.page() - 1) * this.pageSize() + 1 : 0));
  rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
  isFirstLoad = computed(() => this.result() === null && !this.failed());
  isEmptyLibrary = computed(
    () => this.result() !== null && this.total() === 0 && !this.query() && !this.hasFilters()
  );

  // removable "chips" for the active filters
  chips = computed(() => {
    const f = this.filters();
    const out: { key: keyof BookFilters; label: string }[] = [];
    if (f.category) out.push({ key: 'category', label: `Category: ${f.category}` });
    if (f.language) out.push({ key: 'language', label: `Language: ${f.language}` });
    if (f.publisher) out.push({ key: 'publisher', label: `Publisher: ${f.publisher}` });
    if (f.available) out.push({ key: 'available', label: f.available === 'true' ? 'Available' : 'Not available' });
    return out;
  });

  skeletonRows = [1, 2, 3, 4, 5, 6];

  private searchBox = viewChild<ElementRef<HTMLElement>>('searchBox');
  private live$ = new Subject<string>(); // reloads the table while typing
  private load$ = new Subject<void>();

  constructor() {
    // Every change (search, filter, sort, page, page size, add / edit / delete) ends in reload().
    // switchMap cancels an older request when a newer one starts.
    this.load$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
        }),
        switchMap(() =>
          this.bookService.searchPage(this.currentQuery()).pipe(
            catchError(() => {
              this.failed.set(true);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((res) => {
        this.loading.set(false);
        if (!res) return;
        // the current page no longer exists (e.g. the last book of the last page was deleted)
        if (res.totalPages > 0 && this.page() > res.totalPages) {
          this.page.set(res.totalPages);
          this.reload();
          return;
        }
        this.result.set(res);
      });

    // Live table: 300ms after the user stops typing, search and reload the table (no Enter needed).
    // This is the only search request while typing; the suggestions reuse its rows.
    this.live$
      .pipe(debounceTime(300), map((t) => t.trim()), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((t) => {
        if (t === this.query()) return; // Enter / suggestion click / clear already searched this
        this.query.set(t);
        this.page.set(1);
        this.reload();
      });

    // after an add / edit / delete: ask the backend for the current page again
    this.store.changes.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
  }

  ngOnInit() {
    this.store.loadOptions();
    if (!this.canEdit()) this.loans.load(); // normal users only: so each row knows whether I already borrowed it
    this.reload();
  }

  canBorrow(book: Book) {
    return !!book.available && Number(book.quantity) > 0;
  }

  private currentQuery(): BookQuery {
    const { key, dir } = this.sort();
    return { query: this.query(), filters: this.filters(), sort: key, dir, page: this.page(), size: this.pageSize() };
  }

  reload() {
    this.load$.next();
  }

  // ---------- search ----------
  onSearchInput(text: string) {
    this.search.set(text);
    this.showSuggestions.set(true);
    this.activeIndex.set(-1);
    this.live$.next(text);
  }

  runSearch(text: string) {
    this.search.set(text);
    this.query.set(text.trim());
    this.showSuggestions.set(false);
    this.live$.next(text); // keeps a pending live search from overriding this one
    this.page.set(1);
    this.reload();
  }

  clearSearch() {
    this.search.set('');
    this.query.set('');
    this.live$.next('');
    this.page.set(1);
    this.reload();
  }

  onSearchKeys(e: KeyboardEvent) {
    const n = this.suggestions().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.showSuggestions.set(true);
      if (n) this.activeIndex.update((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) this.activeIndex.update((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && this.suggestions()[this.activeIndex()]) {
      e.preventDefault();
      this.runSearch(this.suggestions()[this.activeIndex()]);
    } else if (e.key === 'Escape') {
      this.showSuggestions.set(false);
    }
  }

  // typed part stays normal, the rest of the suggestion is bold
  suggestionParts(text: string) {
    const q = this.search().trim();
    const start = text.toLowerCase().indexOf(q.toLowerCase());
    if (start === -1) return { before: text, match: '', after: '' };
    const end = start + q.length;
    return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
  }

  // close the suggestions when clicking outside the search box
  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(e: MouseEvent) {
    const box = this.searchBox()?.nativeElement;
    if (box && !box.contains(e.target as Node)) this.showSuggestions.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.deleting()) this.deleteTarget.set(null);
  }

  // ---------- filters ----------
  changeFilter(name: keyof BookFilters, value: string) {
    this.filters.update((f) => ({ ...f, [name]: value }));
    this.page.set(1);
    this.reload();
  }

  clearFilters() {
    this.filters.set({ ...emptyFilters });
    this.page.set(1);
    this.reload();
  }


  toggleSort(key: SortKey) {
    this.sort.update((s) =>
      s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' }
    );
    this.page.set(1);
    this.reload();
  }

  sortIcon(key: SortKey): IconName {
    const s = this.sort();
    return s.key !== key ? 'sort' : s.dir === 'asc' ? 'chevronUp' : 'chevronDown';
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sort();
    return s.key !== key ? 'none' : s.dir === 'asc' ? 'ascending' : 'descending';
  }

  changePageSize(size: string | number) {
    this.pageSize.set(Number(size));
    this.page.set(1);
    this.reload();
  }

  goTo(page: number) {
    const next = Math.min(Math.max(1, page), this.totalPages());
    if (next === this.page()) return;
    this.page.set(next);
    this.reload();
  }

  // ---------- delete ----------
  confirmDelete() {
    const book = this.deleteTarget();
    if (!book || book.id === undefined) return;
    this.deleting.set(true);
    this.bookService
      .delete(book.id)
      .pipe(finalize(() => this.deleting.set(false)))
      .subscribe({
        next: () => {
          this.store.remove(book.id!); // fires store.changes -> reload()
          this.toast.success(`"${book.title}" was deleted.`);
          this.deleteTarget.set(null);
        },
        error: (err: HttpErrorResponse) => {
          if (err.status === 401) return; // interceptor already logged the user out
          this.toast.error(err.status === 403 ? "You don't have permission to do this." : 'Could not delete the book.');
        },
      });
  }
}