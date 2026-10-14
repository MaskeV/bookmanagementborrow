# Book Management (Angular)

Angular 21 frontend for the Spring Boot book API (`http://localhost:8080/api`, change it in `src/app/api.config.ts`).

```bash
npm install
npm start        # http://localhost:4200
```

The Spring Boot CORS config must allow `http://localhost:4200`.

## Structure

| Folder | What it does |
|---|---|
| `layout/shell` | Navbar (Dashboard, Books, Add book, user menu) wrapping every logged-in page |
| `dashboard` | Stat cards, books by category / language, recently added |
| `book-manager` | Books page: search with suggestions, filters, sorting and pagination (all done by the backend), delete confirmation |
| `book-dialog` | Add / edit popup, opened by the routes `/books/new` and `/books/:id/edit` |
| `services/book.store.ts` | Shared state: dropdown options, the full list for the Dashboard, and a change event that makes the Books page reload its page |
| `profile` | Profile page: user details, stats and the user's borrowed books (current + history) |
| `services/loan.store.ts` | The logged-in user's loans; Borrow and Return actions |
| `shared` | Icons, toast messages, category colours |
