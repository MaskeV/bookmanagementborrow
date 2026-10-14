import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Loan } from '../models/loan';
import { AuthService } from '../services/auth.service';
import { LoanStore } from '../services/loan.store';
import { Icon } from '../shared/icon';
import { tagStyle } from '../shared/tag-style';

@Component({
  selector: 'app-profile',
  imports: [DatePipe, RouterLink, Icon],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit {
  private auth = inject(AuthService);
  loans = inject(LoanStore);
  tagStyle = tagStyle;

  user = this.auth.session;
  email = this.auth.email;
  isAdmin = computed(() => this.user()?.role === 'ADMIN');
  displayName = computed(() => this.user()?.name || this.email() || 'User');
  initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  });

  tab = signal<'current' | 'history'>('current');
  shown = computed(() => (this.tab() === 'current' ? this.loans.active() : this.loans.history()));
  isFirstLoad = computed(() => !this.loans.loaded() && !this.loans.failed());

  ngOnInit() {
    this.loans.load();
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
