import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { Book } from '../models/book';
import { Loan } from '../models/loan';
import { ToastService } from '../shared/toast.service';
import { AuthService } from './auth.service';
import { BookStore } from './book.store';
import { LoanService } from './loan.service';

// The logged-in user's loans. Loaded once, then updated from the server's reply to every borrow / return.
@Injectable({ providedIn: 'root' })
export class LoanStore {
  private api = inject(LoanService);
  private auth = inject(AuthService);
  private books = inject(BookStore);
  private toast = inject(ToastService);

  readonly loans = signal<Loan[]>([]);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly failed = signal(false);
  // which button is waiting for the server: "book-5" (borrow) or "loan-9" (return)
  readonly busy = signal<string | null>(null);

  readonly active = computed(() => this.loans().filter((l) => !l.returnedAt));
  readonly history = computed(() => this.loans().filter((l) => !!l.returnedAt));
  readonly overdue = computed(() => this.active().filter((l) => l.status === 'OVERDUE'));
  // bookId -> my open loan of that book (tells the Books page to show "Return" instead of "Borrow")
  readonly activeByBook = computed(() => new Map<number | string, Loan>(this.active().map((l) => [l.bookId, l])));

  constructor() {
    // logged out -> forget the loans
    effect(() => {
      if (!this.auth.session()) {
        this.loans.set([]);
        this.loaded.set(false);
        this.failed.set(false);
      }
    });
  }

  load(force = false) {
    if (this.loading() || (this.loaded() && !force)) return;
    this.loading.set(true);
    this.failed.set(false);
    this.api.myLoans().subscribe({
      next: (list) => {
        this.loans.set(list);
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  borrow(book: Book) {
    if (book.id === undefined || this.busy()) return;
    this.busy.set(`book-${book.id}`);
    this.api
      .borrow(book.id)
      .pipe(finalize(() => this.busy.set(null)))
      .subscribe({
        next: (loan) => {
          this.loans.update((list) => [loan, ...list]);
          this.books.invalidate(); // copies changed: Books page reloads, Dashboard reloads next visit
          this.toast.success(`You borrowed "${loan.title}". Due back on ${this.formatDay(loan.dueDate)}.`);
        },
        error: (err) => this.fail(err, 'Could not borrow this book.'),
      });
  }

  giveBack(loan: Loan) {
    if (this.busy()) return;
    this.busy.set(`loan-${loan.id}`);
    this.api
      .giveBack(loan.id)
      .pipe(finalize(() => this.busy.set(null)))
      .subscribe({
        next: (updated) => {
          this.loans.update((list) => list.map((l) => (l.id === updated.id ? updated : l)));
          this.books.invalidate();
          this.toast.success(`"${loan.title}" was returned. Thank you!`);
        },
        error: (err) => this.fail(err, 'Could not return this book.'),
      });
  }

  // the backend explains rule violations in { message }, e.g. "No copies ... available"
  private fail(err: HttpErrorResponse, fallback: string) {
    if (err.status === 401) return; // interceptor already logged the user out
    const message = typeof err.error?.message === 'string' ? err.error.message : fallback;
    this.toast.error(message);
    this.load(true); // our copy may be out of date (e.g. already returned elsewhere)
    this.books.invalidate();
  }

  private formatDay(isoDate: string) {
    return new Date(isoDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
