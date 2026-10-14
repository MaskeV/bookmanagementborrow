export interface Book {
  id?: number | string;
  title?: string;
  author?: string;
  category?: string;
  publisher?: string;
  publicationYear?: number | '';
  language?: string;
  quantity?: number | '';
  description?: string;
  available?: boolean;
}

export interface BookFilters {
  category: string;
  language: string;
  publisher: string;
  available: string; // "", "true" or "false"
}

// one page of results from GET /api/books/search (page is 0-based on the backend)
export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

// distinct values for the dropdown filters, from GET /api/books/filters
export interface FilterOptions {
  categories: string[];
  languages: string[];
  publishers: string[];
}

// everything the Books page sends to the search API (page is 1-based here)
export interface BookQuery {
  query: string;
  filters: BookFilters;
  sort: string | null;
  dir: 'asc' | 'desc';
  page: number;
  size: number;
}

export interface Session {
  token: string;
  name: string;
  email?: string;
  role?: string; // "ADMIN" can add/edit/delete, others can only view/search
}
