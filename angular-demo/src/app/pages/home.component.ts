import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>SSO Mock PoC</h1>
    <p>Public home page. No login required.</p>
    <nav>
      <a routerLink="/login">Login</a> |
      <a routerLink="/protected">Protected</a>
    </nav>
  `,
})
export class HomeComponent {}
