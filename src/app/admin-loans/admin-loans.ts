import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Loan } from '../models/loan';
import { LoanService } from '../services/loan.service';
import { Icon } from '../shared/icon';
import { tagStyle } from '../shared/tag-style';

type Filter = 'all' | 'active' | 'overdue' | 'returned';

// Admin only: every loan of every user - who borrowed which book, and whether it came back.
@Component({
  selector: 'app-admin-loans',
  imports: [DatePipe, FormsModule, Icon],
  templateUrl: './admin-loans.html',
  styleUrl: './admin-loans.css',
})
export class AdminLoans implements OnInit {
  private api = inject(LoanService);
  tagStyle = tagStyle;

  loans = signal<Loan[]>([]);
  loading = signal(false);
  loaded = signal(false);
  failed = signal(false);

  filter = signal<Filter>('all');
  search = signal('');

  // not returned yet (includes overdue)
  active = computed(() => this.loans().filter((l) => !l.returnedAt));
  overdue = computed(() => this.loans().filter((l) => !l.returnedAt && l.status === 'OVERDUE'));
  returned = computed(() => this.loans().filter((l) => !!l.returnedAt));

  shown = computed(() => {
    const byFilter =
      this.filter() === 'active' ? this.active()
      : this.filter() === 'overdue' ? this.overdue()
      : this.filter() === 'returned' ? this.returned()
      : this.loans();
    const q = this.search().trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter((l) =>
      [l.userName, l.userEmail, l.title, l.author].some((v) => (v ?? '').toLowerCase().includes(q))
    );
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
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  initials(name: string): string {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  // "Due in 3 days" / "Due today" / "2 days overdue"
  dueText(loan: Loan): string {
    const due = new Date(loan.dueDate + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((due - today) / 86_400_000);
    if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} overdue`;
    if (days === 0) return 'Due today';
    return `Due in ${days} ${days === 1 ? 'day' : 'days'}`;
  }
}
