# Browser Demo (Angular)

The Angular app proves the *interactive* side: a real OIDC `authorization_code` +
PKCE login through the mock SSO server, followed by an authenticated call to the
Spring API. It is manually verified and is **not** part of the unattended Gatling
test.

## Running it

Start the three services in separate terminals:

```bash
npm run mock-idp   # terminal 1 — http://localhost:9000
npm run spring     # terminal 2 — http://localhost:8080
npm run angular    # terminal 3 — http://localhost:4200
```

Then open <http://localhost:4200>.

## The flow

1. **Home (`/`)** — public page, no login required.
2. Click **Login** (`/login`). The OIDC client redirects to the mock IdP's
   `/oauth/authorize`, sending `response_type=code`, `scope`, `nonce`, and a PKCE
   `code_challenge`.
3. The mock renders a no-password page. Pick **`demo.user`**.
4. You're redirected back to `/callback`, the library exchanges the code for
   tokens, and you land on **`/protected`**.
5. The protected page shows the decoded token claims.
6. Click **Call /api/me** — Angular sends the access token to the Spring API,
   which validates it and returns the user's claims.

The only thing removed versus a real SSO login is the password prompt; the OIDC
mechanics (auth code, PKCE, nonce, ID-token validation) are genuine.

## How the token reaches Spring

`app.config.ts` registers `angular-auth-oidc-client`'s `authInterceptor`, and
`auth.config.ts` lists `http://localhost:8080` as a secure route. The interceptor
attaches `Authorization: Bearer <access_token>` to requests to that origin
automatically — the component code just calls `http.get('.../api/me')`.

## Pages and files

| Route        | File                                       | Purpose                          |
|--------------|--------------------------------------------|----------------------------------|
| `/`          | `pages/home.component.ts`                  | Public landing page              |
| `/login`     | `pages/login.component.ts`                 | Triggers `oidc.authorize()`      |
| `/callback`  | `pages/callback.component.ts`              | Processes the redirect           |
| `/protected` | `pages/protected.component.ts`             | Shows claims, calls `/api/me`    |
| —            | `auth/auth.config.ts`                      | OIDC client configuration        |
| —            | `auth/auth.guard.ts`                       | Guards `/protected`              |

## CORS

The Spring API allows the Angular origin (`http://localhost:4200`) for `GET`,
`POST`, and `OPTIONS` in `SecurityConfig.corsConfigurationSource()`. The mock IdP
returns permissive CORS headers so the browser can read discovery and JWKS
directly.

## Note on minimal OIDC

The mock's discovery document is intentionally minimal, so the Angular config
relaxes a couple of checks (`autoUserInfo: false`, no refresh token). The claims
panel decodes the access token directly rather than calling a userinfo endpoint.
This is a PoC convenience, not something you'd do against a real IdP.
