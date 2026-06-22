# What Is and Isn't Mocked

This PoC implements just enough OIDC to prove the resource-server validation
path. This page is the honest scope statement.

## What works

| Area                                    | Status                                  |
|-----------------------------------------|-----------------------------------------|
| RS256-signed JWTs with stable key       | ✅ key generated per process            |
| JWKS endpoint                           | ✅ `/.well-known/jwks.json`             |
| OIDC discovery document                 | ✅ minimal but valid                    |
| Unattended token issuance               | ✅ `POST /login`                        |
| `authorization_code` + PKCE (browser)   | ✅ via `/oauth/authorize` + `/oauth/token` |
| ID token with `aud=client_id` + `nonce` | ✅                                       |
| Spring signature + issuer validation    | ✅ real, never bypassed                 |
| Claim-based authorization (`groups`)    | ✅ `/api/admin` requires `admin`        |
| Rejecting missing/invalid tokens        | ✅ `401`                                |
| CORS for the Angular origin             | ✅                                       |

## Minimal security requirements

These are intentionally upheld, even though it's a mock:

- Spring **validates JWT signatures**.
- Spring **validates the issuer** (or JWKS).
- Protected endpoints **reject missing tokens** (`401`).
- Protected endpoints **reject invalid tokens** (`401`).
- `/api/admin` **enforces a claim-based rule** (`403` without `admin`).

And these shortcuts are deliberately avoided:

- Spring Security is **not** disabled.
- Unsigned JWTs are **not** accepted.
- There are **no** hardcoded "always authenticated" users in Spring.
- Bearer-token validation is **not** bypassed in Gatling.

## Non-goals

Deliberately **not** implemented:

- Real Okta, Keycloak, Azure Entra, Auth0, or Cognito integration.
- MFA.
- Password reset.
- User registration.
- Real user persistence (the two users are canned, no passwords).
- Refresh-token lifecycle.
- Logout / session correctness.
- Complex Angular UI.
- Full OAuth security hardening beyond what a local unattended test PoC needs.

## The one thing this proves

> A signed token from a local mock OIDC server can satisfy the same Spring Boot
> resource-server validation path that a production SSO token uses.

If that holds, CI can test protected APIs without a human clicking through SSO —
which is the entire point.
