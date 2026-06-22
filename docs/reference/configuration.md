# Configuration

Every configurable value, by component. The defaults are chosen so that
everything works on `localhost` with no configuration at all.

## Mock IdP

Environment variables read by `mock-idp/src/server.ts`:

| Variable   | Default                     | Meaning                                       |
|------------|-----------------------------|-----------------------------------------------|
| `PORT`     | `9000`                      | Listen port                                   |
| `ISSUER`   | `http://localhost:${PORT}`  | `iss` claim and discovery `issuer`            |
| `AUDIENCE` | `spring-demo-api`           | `aud` claim on access tokens                  |

Other fixed values: signing alg `RS256`, key id `mock-idp-key-1`, token TTL
`3600` seconds.

```bash
PORT=9000 ISSUER=http://host.docker.internal:9000 npm --prefix mock-idp run dev
```

## Spring API

Configured in `spring-demo/src/main/resources/application.yml`, overridable via
environment variables (Spring's relaxed binding):

| Property                                                  | Default                   |
|----------------------------------------------------------|---------------------------|
| `server.port`                                            | `8080`                    |
| `spring.security.oauth2.resourceserver.jwt.issuer-uri`   | `http://localhost:9000`   |

The most common override (Docker, or a non-default issuer):

```bash
SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI=http://host.docker.internal:9000
```

If the mock can't produce exactly the discovery metadata you need, you can switch
to validating against the JWKS directly instead of the issuer:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: http://localhost:9000/.well-known/jwks.json
```

`issuer-uri` is preferred because it more closely mirrors real OIDC config.

## Gatling

System properties passed with `-D` (see **[The Unattended Proof](../usage/gatling.md)**):

| Property   | Default                  |
|------------|--------------------------|
| `idp.url`  | `http://localhost:9000`  |
| `api.url`  | `http://localhost:8080`  |
| `users`    | `1`                      |
| `duration` | `0` (single iteration)   |

## Angular

OIDC config in `angular-demo/src/app/auth/auth.config.ts`:

| Setting                 | Value                                  |
|-------------------------|----------------------------------------|
| `authority`             | `http://localhost:9000`                |
| `clientId`              | `angular-demo`                         |
| `redirectUrl`           | `<origin>/callback`                    |
| `scope`                 | `openid profile email api.read`        |
| `responseType`          | `code` (with PKCE)                     |
| `secureRoutes`          | `['http://localhost:8080']`            |

## Docker Compose

`docker-compose.yml` sets, for both services, the issuer to
`http://host.docker.internal:9000` and adds an `extra_hosts` mapping so that
hostname resolves inside the containers. See the **[Docker issuer
caveat](../usage/docker.md#the-issuer-consistency-caveat)**.
