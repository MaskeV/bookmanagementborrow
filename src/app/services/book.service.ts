import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BOOKS_URL } from '../api.config';
import { Book, BookQuery, FilterOptions, Page } from '../models/book';

@Injectable({ providedIn: 'root' })
export class BookService {
  private http = inject(HttpClient);

  // whole library: only the Dashboard still uses this
  getAll(): Observable<Book[]> {
    return this.http.get<Book[]>(BOOKS_URL);
  }

  getById(id: number | string): Observable<Book> {
    return this.http.get<Book>(`${BOOKS_URL}/${id}`);
  }

  // Search, filters, sorting and paging are all done by the backend.
  // The UI counts pages from 1, Spring counts from 0.
  searchPage(q: BookQuery): Observable<Page<Book>> {
    let params = new HttpParams().set('page', q.page - 1).set('size', q.size);
    if (q.query) params = params.set('query', q.query);
    Object.entries(q.filters).forEach(([key, value]) => {
      if (value) params = params.set(key, value);
    });
    if (q.sort) params = params.set('sort', q.sort).set('dir', q.dir);
    return this.http.get<Page<Book>>(`${BOOKS_URL}/search`, { params });
  }

  // distinct categories / languages / publishers for the dropdowns
  filterOptions(): Observable<FilterOptions> {
    return this.http.get<FilterOptions>(`${BOOKS_URL}/filters`);
  }

  // the backend returns the saved book (with its id) for both POST and PUT
  save(book: Book): Observable<Book> {
    return book.id
      ? this.http.put<Book>(`${BOOKS_URL}/${book.id}`, book)
      : this.http.post<Book>(BOOKS_URL, book);
  }

  delete(id: number | string): Observable<void> {
    return this.http.delete<void>(`${BOOKS_URL}/${id}`);
  }
}
