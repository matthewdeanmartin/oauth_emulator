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

## Mock IdP endpoints

| Endpoint                                  | Purpose                                  |
|-------------------------------------------|------------------------------------------|
| `GET /.well-known/openid-configuration`   | OIDC discovery                           |
| `GET /.well-known/jwks.json`              | Public signing key (JWKS)                |
| `POST /login`                             | **Unattended**: mint a JWT for a user    |
| `GET /oauth/authorize`                    | Fake no-password login page (browser)    |
| `POST /oauth/token`                       | `authorization_code` exchange (browser)  |

Two canned users (no passwords): `demo.user` (in group `admin`) and
`plain.user` (not admin — proves `/api/admin` returns 403).

Try it manually:

```bash
npm run mock-idp        # in one terminal
curl http://localhost:9000/.well-known/openid-configuration
curl -X POST http://localhost:9000/login -d username=demo.user
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

## Non-goals

Not production SSO. No real IdP (Okta/Keycloak/Azure/Auth0), MFA, password
reset, registration, user persistence, refresh-token lifecycle, or logout
correctness. Just enough OIDC to prove the resource-server validation path.
