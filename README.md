# SSO Mock PoC

Proof of concept: **swap a real interactive SSO server for a local mock OIDC
server, and still run unattended API tests and load tests** (Gatling) — plus an
optional browser login demo (Angular).

The core proof:

> A signed JWT from a local mock OIDC server satisfies the **same** Spring Boot
> resource-server validation path (signature + issuer + claim rules) that a
> production SSO token would. So CI can test protected APIs with no human
> clicking through SSO.

## The flow this emulates

This is **not** server-to-server `client_credentials`. It models a real user
session:

1. A user "signs in" at the SSO server and receives a signed JWT.
2. The user sends that JWT to the backend API as a `Bearer` token.
3. The backend validates the JWT's signature + issuer against the SSO server's
   published JWKS / discovery document, and applies claim-based rules.

For unattended tests, step 1 is just an HTTP call that mints the token — no
password, no browser, no redirects.

## Components

| Dir            | What                                   | Port |
|----------------|----------------------------------------|------|
| `mock-idp/`    | Node/TS mock OIDC server (`jose`)      | 9000 |
| `spring-demo/` | Spring Boot OAuth2 resource server     | 8080 |
| `gatling/`     | Gatling unattended API/load simulation | —    |
| `angular-demo/`| Angular browser login demo             | 4200 |

## Prerequisites

- Node 20+ and npm
- Java 21 + Maven 3.9+
- (Optional) Docker, for `docker-compose`

## Quick start — the unattended proof

```bash
# from the repo root
npm run build      # installs mock-idp deps, packages Spring
npm run test:poc   # starts mock-idp + Spring, runs Gatling, tears down, exits 0/1
```

`npm run test:poc` is fully unattended. It:

1. Starts the mock IdP (port 9000).
2. Starts the Spring API (port 8080), which validates JWTs against the mock's
   `issuer-uri`.
3. Waits for both health checks.
4. Runs the Gatling simulation: sign in → get JWT → call `/public`, `/api/me`,
   `/api/admin` with the bearer token, asserting expected statuses.
5. Tears everything down and **exits non-zero on any failure**.

Expected: `BUILD SUCCESS`, 4/4 requests OK, exit code 0.

## Live online check (narrated demo)

Want to *watch* a token get minted and validated online, instead of running the
Gatling harness? Use:

```bash
npm run demo:online
```

It starts the mock IdP + Spring, then narrates each step to the terminal:

1. `POST /login` to the mock IdP → mint a signed JWT (no password, no secret).
2. Decode + print the JWT header and claims so you can read what's inside.
3. `GET /api/me` with the bearer token → Spring validates it **offline** (see
   below) and echoes the claims.
4. `GET /api/admin` as `demo.user` (in `admin`) → 200.
5. `GET /api/admin` as `plain.user` (not admin) → 403 (real claim rule).
6. `GET /api/me` with no token → 401 (Spring Security is not disabled).
7. **Call-home** to `GET /userinfo` and `POST /introspect` → confirm the user is
   still active (200 / `active:true`).
8. `POST /admin/revoke` → simulate the user being **fired / deprovisioned** in
   some oauth servers. The JWT is *not* touched.
9. Repeat the call-home with the **same unexpired JWT** → now rejected (`401` /
   `active:false`).
10. `GET /api/me` again → Spring **still returns 200**, because its offline check
    can't see the revoke — which is exactly why the call-home exists.
11. `POST /admin/set-groups` → strip a role mid-session; introspection reflects
    the new groups live.

Then it tears everything down. Set `DEMO_NO_START=1` to run the checks against
services you already started in other terminals.

### Two validation paths: offline JWT vs. online call-home

This PoC deliberately shows **both** checks a real deployment uses, because they
answer different questions:

| Check | Who | How | Sees a revoke? |
|-------|-----|-----|----------------|
| **Offline JWT validation** | Spring resource server | Fetches discovery + JWKS **once**, then validates each token in-process (signature + issuer + expiry) | **No** — a valid, unexpired token always passes |
| **Online call-home** | Your app, mid-session | Calls the IdP's `/userinfo` or `/introspect` to re-check live state | **Yes** — reflects revoke / role change immediately |

The offline path is fast and self-contained, but a JWT is a *snapshot* from when
the user signed in. If the token lives 5–60 minutes, the app may re-check the
authoritative identity source ("has this user been fired or lost a role since?").
That source is some oauth server; the mock's
`/userinfo` + `/introspect` endpoints stand in for it, and `/admin/*` lets a test
flip a user's state so you can watch a still-valid token get its access withdrawn.

Because your app is *configured* with the two call-home URLs, the exact paths on
the mock don't matter — point them at `/userinfo` and `/introspect`, or at the
PingFederate-style aliases `/idp/userinfo.openid` and `/as/introspection.oauth2`
which the mock also serves. Both are advertised in the discovery document
(`userinfo_endpoint`, `introspection_endpoint`).

### client_id / client_secret

There is **no client secret** anywhere. The mock models a **public client**
(discovery advertises `token_endpoint_auth_methods_supported: ["none"]`), the
kind a browser SPA uses with `authorization_code` + PKCE:

- `client_id` is only carried through the browser flow so the `id_token`'s
  audience matches what the Angular OIDC library expects. It is never checked
  against a client registry.
- `client_secret` doesn't exist — there is no `client_credentials` grant and no
  confidential client. The unattended `/login` endpoint needs no `client_id` at
  all. `/introspect` (normally a confidential-client endpoint) *accepts* client
  credentials but does not verify them — it's a mock. If your real app sends a
  client_id/secret on the introspection call, the mock will simply ignore them.

## Mock IdP endpoints

| Endpoint                                  | Purpose                                  |
|-------------------------------------------|------------------------------------------|
| `GET /.well-known/openid-configuration`   | OIDC discovery                           |
| `GET /.well-known/jwks.json`              | Public signing key (JWKS)                |
| `POST /login`                             | **Unattended**: mint a JWT for a user    |
| `GET /oauth/authorize`                    | Fake no-password login page (browser)    |
| `POST /oauth/token`                       | `authorization_code` exchange (browser)  |
| `GET /userinfo`                           | **Call-home**: current claims, or 401 if revoked (alias `/idp/userinfo.openid`) |
| `POST /introspect`                        | **Call-home**: RFC 7662 `{active, …}` (alias `/as/introspection.oauth2`) |
| `POST /admin/revoke`                      | Test control: mark a user fired/deprovisioned |
| `POST /admin/restore`                     | Test control: re-activate a user         |
| `POST /admin/set-groups`                  | Test control: change a user's roles mid-session |

Two canned users (no passwords): `demo.user` (in group `admin`) and
`plain.user` (not admin — proves `/api/admin` returns 403).

Try it manually:

```bash
npm run mock-idp        # in one terminal
curl http://localhost:9000/.well-known/openid-configuration

# Mint a token, then use it for the call-home checks:
TOKEN=$(curl -s -X POST http://localhost:9000/login -d username=demo.user | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:9000/userinfo        # 200 + claims
curl -s -X POST http://localhost:9000/introspect -d "token=$TOKEN"              # {active:true,…}

# Fire the user, then re-run the call-home with the SAME token:
curl -s -X POST http://localhost:9000/admin/revoke -d username=demo.user
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:9000/userinfo        # 401 now
curl -s -X POST http://localhost:9000/introspect -d "token=$TOKEN"              # {active:false}
```

## Spring API endpoints

| Endpoint              | Auth                                  |
|-----------------------|---------------------------------------|
| `GET /public`         | none → 200                            |
| `GET /actuator/health`| none → 200                            |
| `GET /api/me`         | valid bearer token → 200 (echo claims)|
| `GET /api/admin`      | bearer token **in group `admin`** → 200, else 403 |

Security is genuine: signatures are validated, the issuer is validated, missing
or invalid tokens are rejected (401), and `/api/admin` enforces a claim-based
rule (403 without the `admin` group). Spring Security is never disabled.

## Gatling load profile

Default: 1 user, 1 iteration (the acceptance criteria). Optional load run:

```bash
mvn -f gatling/pom.xml gatling:test \
  -Dgatling.simulationClass=com.example.ssopoc.SsoSimulation \
  -Dusers=10 -Dduration=30
```

Overridable system properties: `idp.url`, `api.url`, `users`, `duration`.

## Angular browser demo (manual)

```bash
npm run mock-idp   # terminal 1
npm run spring     # terminal 2  (or: java -jar spring-demo/target/spring-demo-1.0.0.jar)
npm run angular    # terminal 3
```

Then open <http://localhost:4200>:

1. Click **Login** → redirected to the mock SSO page.
2. Pick `demo.user` (no password).
3. Land on `/protected`, see the token claims.
4. Click **Call /api/me** → Spring returns your claims (validated JWT).

The mock drives a real `authorization_code` + PKCE flow; only the password
prompt is removed. This path is verified end-to-end with Playwright.

## Docker

```bash
docker compose up --build   # mock-idp + spring-demo
```

See `docker-compose.yml` for the issuer-consistency note (the JWT `iss`, the
discovery `issuer`, and Spring's `issuer-uri` must all agree — the compose file
pins them to `host.docker.internal:9000`). For the simplest setup, prefer the
local `npm run test:poc` path.

## Root scripts

| Script               | Does                                            |
|----------------------|-------------------------------------------------|
| `npm run build`      | Install mock-idp deps, package Spring           |
| `npm run mock-idp`   | Start mock IdP (tsx)                             |
| `npm run spring`     | Start Spring API (`spring-boot:run`)            |
| `npm run gatling`    | Run Gatling against already-running services    |
| `npm run angular`    | Start Angular dev server                         |
| `npm run test:poc`   | **One-command unattended proof** (start→test→teardown) |

## Tests

- Spring: `mvn -f spring-demo/pom.xml test` — 5 tests covering the full auth
  matrix (public, no-token 401, valid-token claims, admin 200, non-admin 403).
- Gatling: the simulation asserts 0 failed requests.

## Dependency security

```bash
make audit        # scan all deps for known CVEs (npm + Maven)
make audit-npm    # just the Node projects
make audit-java   # just the Maven projects (OWASP Dependency-Check)
```

A 2-day install **cooloff** for npm is set in the root `.npmrc`
(`min-release-age=2`) — project-scoped, no global config. Maven has no local
cooloff equivalent; see `docs/usage/security.md` for the repository-manager /
Renovate approaches.

## Non-goals

Not production SSO. No real IdP (Okta/Keycloak/Azure/Auth0), MFA, password
reset, registration, user persistence, refresh-token lifecycle, or logout
correctness. Just enough OIDC to prove the resource-server validation path.
