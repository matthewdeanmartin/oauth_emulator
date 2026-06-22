# sso-mock-poc

`sso-mock-poc` is a proof of concept that swaps a **real interactive SSO server
for a local mock OIDC server** — and still runs unattended API tests and load
tests against a protected backend.

The whole point, in one sentence:

> A signed JWT from a local mock OIDC server satisfies the **same** Spring Boot
> resource-server validation path (signature + issuer + claim rules) that a
> production SSO token would. So CI can test protected APIs without a human
> clicking through SSO.

It bundles four small pieces that talk to each other:

- a **mock OIDC server** (Node/TypeScript) that issues signed JWTs and publishes
  discovery + JWKS,
- a **Spring Boot resource server** that validates those JWTs exactly as it would
  validate production SSO tokens,
- a **Gatling** simulation that proves the unattended API/load-test path, and
- a minimal **Angular** app that proves the interactive browser login still works.

## The flow this emulates

This is **not** server-to-server `client_credentials`. It models a real user
session:

1. A user signs in at the SSO server and receives a signed JWT.
2. The user sends that JWT to the backend API as a `Bearer` token.
3. The backend validates the JWT's signature + issuer against the SSO server's
   published JWKS / discovery document, and applies claim-based rules.

For unattended tests, step 1 is just an HTTP call that mints the token — no
password, no browser, no redirects.

## One command

```bash
npm run build      # install mock-idp deps, package Spring
npm run test:poc   # start mock-idp + Spring, run Gatling, tear down, exit 0/1
```

`npm run test:poc` starts the mock IdP and the Spring API, waits for both health
checks, runs the Gatling simulation (sign in → get JWT → call `/public`,
`/api/me`, `/api/admin` with the bearer token), tears everything down, and
**exits non-zero on any failure**. That is the core proof.

## Where to go next

- **[What It Is](overview/README.md)** — components, ports, and the problem it solves.
- **[How It Works](overview/how-it-works.md)** — the token lifecycle and the
  resource-server validation path.
- **[Installation](installation.md)** — prerequisites and first build.
- **[Quick Start](usage/quickstart.md)** — run it and see the proof pass.
- **[The Unattended Proof (Gatling)](usage/gatling.md)** — the simulation and load profiles.
- **[Browser Demo (Angular)](usage/angular.md)** — the interactive login flow.
- **[Docker](usage/docker.md)** — running the stack in containers, and the issuer caveat.
- **[Mock IdP Endpoints](reference/mock-idp.md)** / **[Spring API Endpoints](reference/spring-api.md)**.
- **[Configuration](reference/configuration.md)** — every knob and env var.
- **[What Is and Isn't Mocked](reference/coverage.md)** — scope and non-goals.
- **[Troubleshooting](troubleshooting.md)** — the issues you'll actually hit.

## License

MIT.
