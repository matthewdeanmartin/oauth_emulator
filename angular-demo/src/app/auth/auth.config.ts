import { PassedInitialConfig } from 'angular-auth-oidc-client';

/**
 * OIDC config targeting the local mock IdP. The mock issues RS256-signed JWTs
 * and publishes discovery + JWKS, so the standard authorization_code flow works.
 *
 * The mock's /oauth/authorize renders a no-password "pick a user" page, so the
 * browser login is real OIDC mechanics without a real SSO server.
 */
export const authConfig: PassedInitialConfig = {
  config: {
    authority: 'http://localhost:9000',
    redirectUrl: window.location.origin + '/callback',
    postLogoutRedirectUri: window.location.origin,
    clientId: 'angular-demo',
    scope: 'openid profile email api.read',
    responseType: 'code',
    silentRenew: false,
    useRefreshToken: false,
    // The mock's discovery doc is minimal; relax validation suited to the PoC.
    autoUserInfo: false,
    // Send the access token to our Spring API on these origins.
    secureRoutes: ['http://localhost:8080'],
  },
};
