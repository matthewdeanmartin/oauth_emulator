# What It Is

`sso-mock-poc` proves that you can replace an interactive SSO provider with a
local mock in automated tests, without weakening the backend's security path.

## The problem

A test suite for a protected API shouldn't have to choose between:

1. **Hitting the real SSO server** — slow, interactive (browser login, MFA),
   often impossible in CI, and dependent on a shared environment; or
2. **Disabling security in tests** — which means you're no longer testing the
   thing that matters, and bugs in your auth rules slip through.

`sso-mock-poc` is a third option: a *real* OIDC server that issues *real* signed
JWTs, so the backend's validation path (signature, issuer, claim rules) runs
unchanged — but the "login" is an unattended HTTP call instead of a human at a
browser.

## Components

| Directory       | What                                       | Port |
|-----------------|--------------------------------------------|------|
| `mock-idp/`     | Node/TypeScript mock OIDC server (`jose`)  | 9000 |
| `spring-demo/`  | Spring Boot OAuth2 resource server         | 8080 |
| `gatling/`      | Gatling unattended API/load simulation     | —    |
| `angular-demo/` | Angular browser login demo                 | 4200 |

### Mock IdP (`mock-idp/`)

A tiny Express server using [`jose`](https://github.com/panva/jose) for RS256
signing. It generates a signing key at startup, publishes a JWKS and an OIDC
discovery document, and offers two ways to get a token:

- `POST /login` — unattended; mint a JWT for a named user (no password). This is
  what Gatling calls.
- `GET /oauth/authorize` + `POST /oauth/token` — a real `authorization_code` +
  PKCE flow with a no-password "pick a user" page, for the Angular browser demo.

Two canned users ship with it: `demo.user` (in the `admin` group) and
`plain.user` (not an admin — so you can prove `/api/admin` returns 403).

### Spring resource server (`spring-demo/`)

Spring Boot 3 with `spring-boot-starter-oauth2-resource-server`. It validates
incoming JWTs against the mock IdP's `issuer-uri`, maps the custom `groups`
claim onto Spring authorities, and enforces a claim-based rule on `/api/admin`.
Spring Security is never disabled.

### Gatling (`gatling/`)

A simulation written in Gatling's Java DSL. It signs in at the mock IdP, captures
the access token, and calls the public and protected endpoints with the bearer
token, asserting the expected status codes. The build fails on any failed
request, so it gates CI.

### Angular (`angular-demo/`)

A three-page Angular app (`/`, `/login`, `/protected`) using
[`angular-auth-oidc-client`](https://github.com/damienbod/angular-auth-oidc-client).
It drives the real browser `authorization_code` + PKCE flow against the mock,
then calls the Spring API with the bearer token.

## What it is not

Not production SSO, and not a real IdP emulator. See
**[What Is and Isn't Mocked](../reference/coverage.md)** for the full non-goals
list (no MFA, password reset, registration, user persistence, refresh-token
lifecycle, or logout correctness).
