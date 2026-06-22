import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { JsonPipe } from '@angular/common';
import { OidcSecurityService } from 'angular-auth-oidc-client';

/**
 * Protected page. Shows the logged-in user's token claims and calls the Spring
 * API's GET /api/me with the bearer token (added automatically by the OIDC
 * client's interceptor for the configured secureRoute).
 */
@Component({
  selector: 'app-protected',
  standalone: true,
  imports: [JsonPipe],
  template: `
    <h1>Protected</h1>

    <h2>Token claims</h2>
    <pre>{{ claims() | json }}</pre>

    <h2>GET /api/me (from Spring)</h2>
    <button (click)="callApi()">Call /api/me</button>
    <pre>{{ apiResult() | json }}</pre>
  `,
})
export class ProtectedComponent {
  private oidc = inject(OidcSecurityService);
  private http = inject(HttpClient);

  claims = signal<unknown>(null);
  apiResult = signal<unknown>(null);

  constructor() {
    // autoUserInfo is off, so show the decoded access-token payload directly.
    this.oidc.getAccessToken().subscribe((token) => {
      if (token) {
        this.claims.set(this.decodeJwt(token));
      }
    });
  }

  private decodeJwt(token: string): unknown {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return { error: 'could not decode token' };
    }
  }

  callApi(): void {
    this.http
      .get('http://localhost:8080/api/me')
      .subscribe({
        next: (res) => this.apiResult.set(res),
        error: (err) => this.apiResult.set({ error: err.status, message: err.message }),
      });
  }
}
