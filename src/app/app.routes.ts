import { Routes } from '@angular/router';
import { AuthPage } from './auth-page/auth-page';
import { BookDialog } from './book-dialog/book-dialog';
import { BookManager } from './book-manager/book-manager';
import { Dashboard } from './dashboard/dashboard';
import { adminGuard, authGuard, guestGuard, homeGuard } from './guards/auth.guard';
import { Shell } from './layout/shell';
import { AdminLoans } from './admin-loans/admin-loans';
import { Profile } from './profile/profile';

export const routes: Routes = [
  { path: 'login', component: AuthPage, canActivate: [guestGuard] },
  {
    // everything inside the navbar layout needs a login
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: Dashboard, canActivate: [adminGuard] }, // admin only
      { path: 'loans', component: AdminLoans, canActivate: [adminGuard] }, // admin only: who borrowed / returned what
      { path: 'profile', component: Profile },
      {
        path: 'books',
        component: BookManager,
        children: [
          // these open the add / edit popup on top of the books table
          { path: 'new', component: BookDialog, canActivate: [adminGuard] },
          { path: ':id/edit', component: BookDialog, canActivate: [adminGuard] },
        ],
      },
      { path: '', pathMatch: 'full', canActivate: [homeGuard], children: [] },
    ],
  },
  { path: '**', redirectTo: '' },
];
