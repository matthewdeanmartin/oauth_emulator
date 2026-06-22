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

## Canned users

| Username     | `sub`      | Groups                   | `/api/admin` |
|--------------|------------|--------------------------|--------------|
| `demo.user`  | `user-123` | `demo-users`, `admin`    | 200          |
| `plain.user` | `user-456` | `demo-users`             | 403          |

Defined in `mock-idp/src/users.ts`. There is no password checking by design.
