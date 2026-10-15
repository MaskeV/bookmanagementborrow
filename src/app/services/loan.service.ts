import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE } from '../api.config';
import { Loan } from '../models/loan';

const LOANS_URL = `${API_BASE}/loans`;

@Injectable({ providedIn: 'root' })
export class LoanService {
  private http = inject(HttpClient);

  myLoans(): Observable<Loan[]> {
    return this.http.get<Loan[]>(`${LOANS_URL}/my`);
  }

  // ADMIN only: every loan of every user
  allLoans(): Observable<Loan[]> {
    return this.http.get<Loan[]>(LOANS_URL);
  }

  borrow(bookId: number | string): Observable<Loan> {
    return this.http.post<Loan>(`${LOANS_URL}/${bookId}`, null);
  }

  giveBack(loanId: number): Observable<Loan> {
    return this.http.post<Loan>(`${LOANS_URL}/${loanId}/return`, null);
  }
}
