# Docker

`docker-compose.yml` runs the mock IdP and the Spring resource server in
containers. Angular and Gatling run from the host.

```bash
docker compose up --build
```

This builds and starts:

- **`mock-idp`** on port `9000`,
- **`spring-demo`** on port `8080`, depending on `mock-idp`.

## The issuer-consistency caveat

This is the one thing that bites people, so it gets its own section.

Three values must agree for JWT validation to pass:

1. the `iss` claim inside every token the mock issues,
2. the `issuer` field in the mock's discovery document, and
3. Spring's configured `issuer-uri`.

Inside Docker, services reach each other by service name (`mock-idp`), but a
token whose `iss` is `http://localhost:9000` won't validate if Spring's
`issuer-uri` is `http://mock-idp:9000` — the issuers differ.

The compose file solves this by pinning **all three** to
`http://host.docker.internal:9000`:

- the mock is started with `ISSUER=http://host.docker.internal:9000`, so that's
  the `iss` and the discovery `issuer`;
- Spring is configured with
  `SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI=http://host.docker.internal:9000`;
- an `extra_hosts: ["host.docker.internal:host-gateway"]` entry makes that
  hostname resolve inside the containers (needed on Linux; automatic on Docker
  Desktop for Windows/macOS).

## Simplest path: don't use Docker

For the PoC, the local `npm run test:poc` path avoids the issuer juggling
entirely — everything runs on `localhost:9000` / `localhost:8080`, so all three
issuer values are trivially identical. Favor that unless you specifically need
the containerized stack.

See **[Configuration](../reference/configuration.md)** for the full list of
environment variables and overrides.
