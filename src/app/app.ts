import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { Toasts } from './shared/toasts';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toasts],
  template: '<router-outlet /><app-toasts />',
})
export class App {
  constructor() {
    inject(ThemeService); // applies the saved theme as early as possible
  }
}
