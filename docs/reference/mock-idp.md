# Mock IdP Endpoints

The mock IdP (`mock-idp/src/server.ts`) listens on `http://localhost:9000` by
default. All endpoints return permissive CORS headers so the browser app can call
them directly.

## Summary

| Method | Path                                    | Purpose                                  |
|--------|-----------------------------------------|------------------------------------------|
| GET    | `/.well-known/openid-configuration`     | OIDC discovery document                  |
| GET    | `/.well-known/jwks.json`                | Public signing key (JWKS)                |
| POST   | `/login`                                | **Unattended** — mint a JWT for a user   |
| GET    | `/oauth/authorize`                      | No-password login page (browser flow)    |
| POST   | `/oauth/token`                          | `authorization_code` token exchange      |
| GET    | `/userinfo`                             | **Call-home** — current claims / 401 (alias `/idp/userinfo.openid`) |
| POST   | `/introspect`                           | **Call-home** — RFC 7662 `{active, …}` (alias `/as/introspection.oauth2`) |
| POST   | `/admin/revoke`                         | Test control — mark a user fired         |
| POST   | `/admin/restore`                        | Test control — re-activate a user        |
| POST   | `/admin/set-groups`                     | Test control — change a user's roles     |
| GET    | `/health`                               | Liveness check (`{"status":"UP"}`)       |

## `GET /.well-known/openid-configuration`

Returns the discovery document: `issuer`, `authorization_endpoint`,
`token_endpoint`, `jwks_uri`, supported response types (`code`), signing alg
(`RS256`), scopes, and PKCE methods (`S256`). Spring's `issuer-uri` config reads
this to find the JWKS.

## `GET /.well-known/jwks.json`

Returns `{ "keys": [ <public RSA JWK> ] }` with `kid: mock-idp-key-1`, `use:
sig`, `alg: RS256`. Spring fetches and caches this to verify token signatures.

## `POST /login`

The unattended path — what Gatling uses. Mints a signed access token for a named
user, with no password.

**Request** (form or JSON):

```bash
curl -X POST http://localhost:9000/login -d username=demo.user
```

`username` defaults to `demo.user` if omitted. Known users: `demo.user`,
`plain.user`. An unknown user returns `400` with `known_users`.

**Response:**

```json
{
  "access_token": "<signed JWT>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email api.read"
}
```

The access token's audience is `spring-demo-api`.

## `GET /oauth/authorize`

The interactive entry point for the browser flow. Renders a minimal HTML page
listing the canned users; each is a link that redirects back to the caller's
`redirect_uri` with an authorization `code` and the original `state`.

Reads these query params: `redirect_uri`, `state`, `client_id` (default
`angular-demo`), and `nonce`. The `client_id` and `nonce` are encoded into the
auth code so the token endpoint can build a correct ID token.

## `POST /oauth/token`

Exchanges an authorization code for tokens. Only `grant_type=authorization_code`
is supported.

**Request:**

```bash
curl -X POST http://localhost:9000/oauth/token \
  -d grant_type=authorization_code \
  -d code=<code> \
  -d redirect_uri=http://localhost:4200/callback
```

**Response:**

```json
{
  "access_token": "<JWT, aud=spring-demo-api>",
  "id_token": "<JWT, aud=client_id, includes nonce>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email api.read"
}
```

See **[How It Works → Two tokens, two audiences](../overview/how-it-works.md#two-tokens-two-audiences)**
for why the access token and ID token have different audiences.

## Call-home endpoints (online recheck)

A JWT is a snapshot from sign-in time. Some apps re-check the identity source
mid-session ("has this user been fired or lost a role since the token was
minted?") because a token can stay signature-valid and unexpired long after the
user's access should have ended. That authoritative source is typically an IGA
system such as **SailPoint IdentityIQ**; these two endpoints stand in for it.

Both verify the presented token's signature + issuer + expiry first. On top of
that, they consult the user's **current** governance state (mutable via the
`/admin/*` endpoints), so a revoked user is rejected even with a valid token.

### `GET /userinfo`  (alias `GET /idp/userinfo.openid`)

OIDC UserInfo. Send the access token as a Bearer:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:9000/userinfo
```

- **200** with current claims (`sub`, `preferred_username`, `email`, `name`,
  `groups`) while the user is active.
- **401** (`WWW-Authenticate: Bearer`) if the token is invalid/expired, or the
  user has been revoked/deprovisioned since it was minted.

### `POST /introspect`  (alias `POST /as/introspection.oauth2`)

OAuth2 Token Introspection (RFC 7662):

```bash
curl -X POST http://localhost:9000/introspect -d "token=<token>"
```

- Active user → `{ "active": true, "sub": …, "groups": [ … current roles … ], … }`.
- Revoked user, or invalid/expired token → `{ "active": false }` (HTTP 200, per
  RFC 7662).

Client credentials are *accepted but not enforced* — this is a mock. See the
README's client_id/client_secret note.

## Admin endpoints (test control surface)

These emulate an administrator changing a user's state in the IGA system. They
have **no authentication on purpose** — they are a test hook, not a real API.

| Endpoint | Body | Effect |
|----------|------|--------|
| `POST /admin/revoke` | `{ "username": "demo.user" }` | Call-homes for this user now fail (fired) |
| `POST /admin/restore` | `{ "username": "demo.user" }` | Re-activate the user |
| `POST /admin/set-groups` | `{ "username": "demo.user", "groups": ["demo-users"] }` | Replace the user's roles mid-session |

Unknown user → `404`. State is in-memory and resets when the mock restarts.
Note these change what the **call-home** returns; they do **not** change or
invalidate already-issued JWTs, so Spring's offline validation of an existing
token is unaffected — which is precisely why the call-home is needed.

## Canned users

| Username     | `sub`      | Groups                   | `/api/admin` |
|--------------|------------|--------------------------|--------------|
| `demo.user`  | `user-123` | `demo-users`, `admin`    | 200          |
| `plain.user` | `user-456` | `demo-users`             | 403          |

Defined in `mock-idp/src/users.ts`. There is no password checking by design.
