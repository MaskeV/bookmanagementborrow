import { Injectable, effect, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Book, FilterOptions } from '../models/book';
import { AuthService } from './auth.service';
import { BookService } from './book.service';

// Shared state:
//  - allBooks: the whole library, used only by the Dashboard statistics (loaded once)
//  - options: dropdown values for the filters, used by the Books page and the add/edit popup
//  - changes: fires after every add / edit / delete so the Books page reloads its current page
@Injectable({ providedIn: 'root' })
export class BookStore {
  private api = inject(BookService);
  private auth = inject(AuthService);

  readonly allBooks = signal<Book[]>([]);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly options = signal<FilterOptions>({ categories: [], languages: [], publishers: [] });
  private optionsLoaded = false;
  // emits after every add / edit / delete so pages showing server-side results can refresh
  readonly changes = new Subject<void>();

  constructor() {
    // logged out (manually or by a 401) -> forget the data
    effect(() => {
      if (!this.auth.session()) this.reset();
    });
  }

  load(force = false) {
    if (this.loading() || (this.loaded() && !force)) return;
    this.loading.set(true);
    this.failed.set(false);
    this.api.getAll().subscribe({
      next: (list) => {
        this.allBooks.set(list);
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  loadOptions(force = false) {
    if (this.optionsLoaded && !force) return;
    this.optionsLoaded = true;
    this.api.filterOptions().subscribe({
      next: (o) => this.options.set(o),
      error: () => (this.optionsLoaded = false), // try again next time
    });
  }

  upsert(book: Book, isNew: boolean) {
    if (this.loaded()) {
      if (book.id === undefined || book.id === null) this.load(true);
      else this.allBooks.update((list) => (isNew ? [...list, book] : list.map((b) => (b.id === book.id ? book : b))));
    }
    // a brand-new category / language / publisher must appear in the dropdowns
    const o = this.options();
    const isNewValue = (v: string | undefined, known: string[]) => !!v && !known.includes(v);
    if (isNewValue(book.category, o.categories) || isNewValue(book.language, o.languages) || isNewValue(book.publisher, o.publishers)) {
      this.loadOptions(true);
    }
    this.changes.next();
  }

  // book copies changed elsewhere (borrow / return): the Dashboard must reload, the Books page reloads its page
  invalidate() {
    this.loaded.set(false);
    this.changes.next();
  }

  remove(id: number | string) {
    if (this.loaded()) this.allBooks.update((list) => list.filter((b) => b.id !== id));
    this.loadOptions(true); // the deleted book may have been the last one of its category
    this.changes.next();
  }

  private reset() {
    this.allBooks.set([]);
    this.loaded.set(false);
    this.loading.set(false);
    this.failed.set(false);
    this.options.set({ categories: [], languages: [], publishers: [] });
    this.optionsLoaded = false;
  }
}
