# Spring API Endpoints

The Spring resource server (`spring-demo/`) listens on `http://localhost:8080`.
It validates JWTs against the mock IdP and enforces claim-based authorization.

## Summary

| Method | Path               | Auth                                          | Success |
|--------|--------------------|-----------------------------------------------|---------|
| GET    | `/public`          | none                                          | 200     |
| GET    | `/actuator/health` | none                                          | 200     |
| GET    | `/api/me`          | valid bearer token                            | 200     |
| GET    | `/api/admin`       | bearer token **in group `admin`**             | 200     |

Missing or invalid tokens on `/api/*` return `401`. A valid token that lacks the
`admin` group returns `403` on `/api/admin`.

## `GET /public`

No authentication. Returns a simple JSON body:

```json
{ "message": "public ok", "authenticated": false }
```

## `GET /actuator/health`

No authentication. Spring Boot Actuator health endpoint; used by the runner to
wait for the app to be ready.

## `GET /api/me`

Requires a valid bearer token. Echoes claims from the JWT:

```json
{
  "subject": "user-123",
  "username": "demo.user",
  "email": "demo.user@example.test",
  "groups": ["demo-users", "admin"]
}
```

```bash
curl http://localhost:8080/api/me -H "Authorization: Bearer $TOKEN"
```

## `GET /api/admin`

Requires a valid bearer token whose `groups` claim contains `admin`. Enforced by
`hasRole("admin")` in `SecurityConfig`, which works because the JWT converter
maps each group to a `ROLE_<group>` authority.

- admin token → `200` with `{ "message": "admin ok", ... }`
- non-admin token → `403`

## Security model

Defined in `spring-demo/src/main/java/com/example/ssopoc/SecurityConfig.java`:

- **JWT validation** via `spring-boot-starter-oauth2-resource-server`, configured
  with `issuer-uri` (signature + issuer are validated against the mock's JWKS and
  discovery doc).
- **Stateless**, bearer-token-only; CSRF disabled (not applicable to a stateless
  token API), sessions never created.
- **`groups` → roles** converter so claim-based rules work.
- **CORS** allows `http://localhost:4200` for the Angular app.

Spring Security is never disabled, unsigned JWTs are never accepted, and there
are no hardcoded "always authenticated" test users. See the **[minimal security
requirements](coverage.md#minimal-security-requirements)**.

## Configuration override

Inside Docker (or any non-`localhost` issuer), override the issuer with:

```text
SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI=http://host.docker.internal:9000
```

See **[Configuration](configuration.md)** and the **[Docker issuer
caveat](../usage/docker.md#the-issuer-consistency-caveat)**.
