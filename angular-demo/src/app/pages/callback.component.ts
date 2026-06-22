import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';

/**
 * Landing point for the OIDC redirect. The library processes the auth code
 * (handled in app config's checkAuth), then we forward to /protected.
 */
@Component({
  selector: 'app-callback',
  standalone: true,
  template: `<p>Signing in...</p>`,
})
export class CallbackComponent {
  private oidc = inject(OidcSecurityService);
  private router = inject(Router);

  constructor() {
    this.oidc.checkAuth().subscribe(({ isAuthenticated }) => {
      this.router.navigate([isAuthenticated ? '/protected' : '/login']);
    });
  }
}
