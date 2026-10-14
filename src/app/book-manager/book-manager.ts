import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Subject, catchError, debounceTime, finalize, map, of, switchMap, tap } from 'rxjs';
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

  // normal users (role USER) can only view and search; ADMIN can add, edit and delete
  canEdit = computed(() => this.auth.session()?.role === 'ADMIN');

  // ---------- what the user asked for (all of it is sent to the backend) ----------
  search = signal(''); // text in the search box
  query = signal(''); // text that was actually searched
  filters = signal<BookFilters>({ ...emptyFilters });
  sort = signal<{ key: SortKey | null; dir: SortDir }>({ key: null, dir: 'asc' });
  pageSize = signal(10);
  page = signal(1); // 1-based
  readonly pageSizes = [10, 25, 50];

  // ---------- what came back ----------
  result = signal<Page<Book> | null>(null);
  loading = signal(false);
  failed = signal(false);

  // suggestions under the search box
  suggestions = signal<string[]>([]);
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
  private typing$ = new Subject<string>();
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

    // Search suggestions (like Amazon): wait 250ms after typing, ask the backend for a few matches,
    // keep a short list of unique titles / authors.
    this.typing$
      .pipe(
        debounceTime(250),
        switchMap((text) => {
          const t = text.trim();
          if (!t) return of<string[]>([]);
          const q: BookQuery = { query: t, filters: emptyFilters, sort: null, dir: 'asc', page: 1, size: 20 };
          return this.bookService.searchPage(q).pipe(
            map((res) => {
              const lower = t.toLowerCase();
              const unique = new Set<string>();
              res.content.forEach((b) =>
                [b.title, b.author].forEach((v) => {
                  if (v && v.toLowerCase().includes(lower)) unique.add(v);
                })
              );
              return [...unique].slice(0, 8);
            }),
            catchError(() => of<string[]>([]))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((list) => {
        this.suggestions.set(list);
        this.activeIndex.set(-1);
      });

    // after an add / edit / delete: ask the backend for the current page again
    this.store.changes.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
  }

  ngOnInit() {
    this.store.loadOptions();
    this.loans.load(); // so each row knows whether I already borrowed it
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
    this.typing$.next(text);
  }

  runSearch(text: string) {
    this.search.set(text);
    this.query.set(text.trim());
    this.showSuggestions.set(false);
    this.typing$.next(text);
    this.page.set(1);
    this.reload();
  }

  clearSearch() {
    this.search.set('');
    this.query.set('');
    this.suggestions.set([]);
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
    } else if (e.key === 'Enter' && this.activeIndex() >= 0) {
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

  // ---------- sorting + paging ----------
  // click a column: ascending -> descending -> back to the default order
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
