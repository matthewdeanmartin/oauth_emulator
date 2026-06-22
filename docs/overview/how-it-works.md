# How It Works

The core idea is that the mock IdP and a real SSO provider look identical from
the backend's point of view: both publish a JWKS and a discovery document, and
both issue RS256-signed JWTs. The backend validates tokens the same way in
either case.

## The token lifecycle

```text
            ┌──────────────┐
            │  mock-idp    │  RS256 signing key (generated at startup)
            │  :9000       │  publishes JWKS + discovery
            └──────┬───────┘
                   │ 1. "sign in" -> signed JWT
                   ▼
   ┌───────────────────────────┐
   │ caller (Gatling or Angular)│
   └───────────────┬───────────┘
                   │ 2. Authorization: Bearer <jwt>
                   ▼
            ┌──────────────┐
            │ spring-demo  │  3. validate signature + issuer against
            │  :8080       │     mock-idp's JWKS; apply claim rules
            └──────────────┘
```

1. **Sign in.** The caller obtains a JWT from the mock IdP. Unattended callers
   `POST /login`; the browser uses the `authorization_code` flow.
2. **Call the API.** The caller sends the JWT as a `Bearer` token.
3. **Validate.** Spring fetches the mock IdP's JWKS (cached), verifies the
   token's RS256 signature, checks the issuer, and rejects anything missing or
   invalid with `401`. Authorization rules then run against the token's claims.

This is the same path a production SSO token takes. Nothing about validation is
mocked or bypassed — only the *issuer* of the token is swapped.

## Two tokens, two audiences

The mock issues two kinds of token, because the OIDC browser client and the
resource server validate different things:

- **Access token** — `aud: spring-demo-api`. This is the bearer token the Spring
  API expects. Returned by `POST /login` and as `access_token` from
  `POST /oauth/token`.
- **ID token** — `aud: <client_id>` (e.g. `angular-demo`), and it echoes the
  `nonce` from the authorize request. The Angular OIDC library validates the ID
  token's audience and nonce; without this it rejects the login. Returned as
  `id_token` from `POST /oauth/token`.

## Token claims

Every token carries the claims the demo needs (values shown for `demo.user`):

```json
{
  "iss": "http://localhost:9000",
  "aud": "spring-demo-api",
  "sub": "user-123",
  "preferred_username": "demo.user",
  "email": "demo.user@example.test",
  "name": "Demo User",
  "scope": "openid profile email api.read",
  "groups": ["demo-users", "admin"]
}
```

## The `groups` claim and authorization

Spring's resource server, by default, only understands the `scope` claim. To
make role-based rules work, `SecurityConfig` installs a converter that maps each
entry in the `groups` array to a `ROLE_<group>` authority. That is what lets
`/api/admin` require `hasRole("admin")`:

- `demo.user` has `groups: ["demo-users", "admin"]` → `/api/admin` returns `200`.
- `plain.user` has `groups: ["demo-users"]` → `/api/admin` returns `403`.

## Why the signing key is generated at startup

The mock generates a fresh RS256 key pair each time it boots and keeps it for the
life of the process. That is all the PoC needs: the JWKS exposes the public half,
Spring fetches it, and every token issued in that run validates. There is no
persisted key, because there is nothing to persist across runs in a test.

## The unattended runner

`npm run test:poc` (the script at `scripts/test-poc.mjs`) orchestrates the proof:

1. Start the mock IdP and wait for `GET /health`.
2. Start the Spring API and wait for `GET /actuator/health`.
3. Run the Gatling simulation (blocking).
4. Tear down both services (kills the process trees).
5. Exit with Gatling's exit code — non-zero on any failure.

No browser, no human, no shared environment.
