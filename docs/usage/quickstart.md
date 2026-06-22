# Quick Start

The fastest path is the one command. The rest of this page shows how to run each
piece by hand so you can watch the auth flow.

## The one command

```bash
npm run build
npm run test:poc
```

`test:poc` starts the mock IdP and Spring, runs Gatling unattended, tears
everything down, and exits `0` on success. That's the whole proof. See
**[The Unattended Proof](gatling.md)** for details.

## Running the pieces by hand

### 1. Start the mock IdP

```bash
npm run mock-idp
```

It listens on `http://localhost:9000`. Confirm it's up and minting tokens:

```bash
curl http://localhost:9000/.well-known/openid-configuration
curl http://localhost:9000/.well-known/jwks.json
curl -X POST http://localhost:9000/login -d username=demo.user
```

The last call returns an OAuth-style token response with an `access_token` — a
signed JWT representing a logged-in `demo.user`.

### 2. Start the Spring API

In another terminal (the mock IdP must already be running, because Spring
validates the issuer at startup):

```bash
npm run spring
# or: java -jar spring-demo/target/spring-demo-1.0.0.jar
```

It listens on `http://localhost:8080`.

### 3. Exercise the endpoints

```bash
# public — no auth, 200
curl -i http://localhost:8080/public

# protected without a token — 401
curl -i http://localhost:8080/api/me

# grab an admin token and call protected endpoints
TOKEN=$(curl -s -X POST http://localhost:9000/login -d username=demo.user \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

curl -i http://localhost:8080/api/me    -H "Authorization: Bearer $TOKEN"   # 200 + claims
curl -i http://localhost:8080/api/admin -H "Authorization: Bearer $TOKEN"   # 200 (admin)

# a non-admin token is forbidden on /api/admin
PLAIN=$(curl -s -X POST http://localhost:9000/login -d username=plain.user \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
curl -i http://localhost:8080/api/admin -H "Authorization: Bearer $PLAIN"   # 403
```

This is the entire security matrix:

| Request                                   | Result |
|-------------------------------------------|--------|
| `GET /public`                             | 200    |
| `GET /api/me` (no token)                  | 401    |
| `GET /api/me` (garbage token)             | 401    |
| `GET /api/me` (valid token)               | 200    |
| `GET /api/admin` (admin token)            | 200    |
| `GET /api/admin` (non-admin token)        | 403    |

## Where to go next

- **[The Unattended Proof (Gatling)](gatling.md)** — automate the above and load-test it.
- **[Browser Demo (Angular)](angular.md)** — the same thing through a real login UI.
- **[Mock IdP Endpoints](../reference/mock-idp.md)** / **[Spring API](../reference/spring-api.md)**.
