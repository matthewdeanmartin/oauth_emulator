import { Component, inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <h1>Login</h1>
    <p>Click to sign in via the mock SSO server.</p>
    <button (click)="login()">Login with Mock SSO</button>
  `,
})
export class LoginComponent {
  private oidc = inject(OidcSecurityService);
  login(): void {
    this.oidc.authorize();
  }
}
