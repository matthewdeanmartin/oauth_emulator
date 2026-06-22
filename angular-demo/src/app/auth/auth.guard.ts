import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map } from 'rxjs';

/** Blocks /protected unless the user is authenticated; otherwise sends to /login. */
export const authGuard: CanActivateFn = () => {
  const oidc = inject(OidcSecurityService);
  const router = inject(Router);
  return oidc.isAuthenticated$.pipe(
    map(({ isAuthenticated }) =>
      isAuthenticated ? true : router.createUrlTree(['/login'])
    )
  );
};
