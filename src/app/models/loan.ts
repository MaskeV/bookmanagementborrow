export type LoanStatus = 'BORROWED' | 'OVERDUE' | 'RETURNED';

// Matches the backend LoanResponse. Dates are ISO strings: dueDate "2026-10-27", borrowedAt "2026-10-13T10:15:30"
export interface Loan {
  id: number;
  bookId: number;
  title: string;
  author: string;
  category: string;
  borrowedAt: string;
  dueDate: string;
  returnedAt: string | null;
  status: LoanStatus;
}
