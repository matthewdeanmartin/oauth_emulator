# Spec: Minimal Unattended SSO Test PoC

## 1. Goal

Build a minimal proof of concept showing that an Angular frontend and a Java Spring Boot backend can run unattended authentication and authorization tests without using the real interactive SSO server.

The PoC must demonstrate:

1. A mock OAuth2/OIDC server starts locally.
2. The Angular demo app can authenticate against the mock server.
3. The Spring Boot demo API accepts JWTs issued by the mock server.
4. Gatling can run an unattended scenario that obtains or uses a token and calls protected backend endpoints.
5. The whole flow can run in CI without browser-based human login.

This is not intended to be production SSO, full IdP emulation, or vendor-specific Okta/Keycloak/Azure behavior.

---

## 2. Non-goals

Do not implement:

1. Real Okta, Keycloak, Azure Entra, Auth0, or Cognito integration.
2. MFA.
3. Password reset.
4. User registration.
5. Real user persistence.
6. Refresh-token lifecycle complexity.
7. Logout/session correctness.
8. Complex Angular UI.
9. Full OAuth security hardening beyond what is needed for a local unattended test PoC.

---

## 3. Proposed repository layout

```text
sso-mock-poc/
  README.md
  docker-compose.yml
  package.json
  .gitignore

  mock-idp/
    package.json
    tsconfig.json
    src/
      server.ts
      users.ts
      claims.ts

  angular-demo/
    package.json
    angular.json
    src/
      app/
        app.component.ts
        app.routes.ts
        auth/
          auth.config.ts
          auth.service.ts
          auth.guard.ts
        pages/
          home.component.ts
          login.component.ts
          protected.component.ts

  spring-demo/
    pom.xml
    src/main/java/com/example/ssopoc/
      SsoPocApplication.java
      SecurityConfig.java
      DemoController.java
    src/main/resources/
      application.yml

  gatling/
    pom.xml
    src/test/scala/com/example/ssopoc/
      SsoSimulation.scala
```

A single repo is preferred for the PoC.

---

## 4. Components

### 4.1 Mock OIDC server

Use a Node/TypeScript mock OAuth2/OIDC server.

Preferred library:

```text
oauth2-mock-server
```

The mock IdP must expose, at minimum:

```text
/.well-known/openid-configuration
/oauth/authorize
/oauth/token
/.well-known/jwks.json
```

The exact paths may follow the library defaults, but Spring and Angular config must point to the correct issuer/discovery URL.

The mock server must issue signed JWTs with a stable test key.

Required token claims:

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

The mock server must support at least one unattended token flow.

Preferred unattended path:

```text
client_credentials
```

Optional browser/demo path:

```text
authorization_code with PKCE
```

For the PoC, Gatling may use `client_credentials` because the primary goal is unattended backend/API testing.

Suggested local configuration:

```text
Mock IdP URL: http://localhost:9000
Issuer: http://localhost:9000
Client ID for Angular: angular-demo
Client ID for Gatling/API test: gatling-client
API audience: spring-demo-api
```

---

### 4.2 Spring Boot demo API

Use Java Spring Boot with Spring Security OAuth2 Resource Server.

The API must validate JWTs issued by the mock IdP.

Minimum dependencies:

```text
spring-boot-starter-web
spring-boot-starter-security
spring-boot-starter-oauth2-resource-server
spring-boot-starter-actuator
```

Required endpoints:

```text
GET /public
GET /api/me
GET /api/admin
GET /actuator/health
```

Behavior:

```text
GET /public
  No authentication required.
  Returns 200 with simple JSON.

GET /api/me
  Requires a valid bearer token.
  Returns claims from the JWT.

GET /api/admin
  Requires a valid bearer token with group "admin".
  Returns 200 for admin token.
  Returns 403 for non-admin token.

GET /actuator/health
  No authentication required.
```

Example response for `/api/me`:

```json
{
  "subject": "user-123",
  "username": "demo.user",
  "email": "demo.user@example.test",
  "groups": ["demo-users", "admin"]
}
```

Spring config must use the mock issuer:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:9000
server:
  port: 8080
```

If the mock server cannot produce exactly the right discovery metadata, use `jwk-set-uri` instead:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: http://localhost:9000/.well-known/jwks.json
```

Prefer `issuer-uri` if it works, because that more closely resembles real OIDC configuration.

---

### 4.3 Angular demo app

Use a minimal Angular app.

The UI only needs three pages:

```text
/
  Public home page.

/login
  Button that initiates login with the mock IdP.

/protected
  Requires login.
  Shows the current user's claims.
  Calls Spring Boot GET /api/me.
```

Use a standard Angular OIDC client library.

Preferred options:

```text
angular-auth-oidc-client
```

or:

```text
angular-oauth2-oidc
```

Pick one. Do not build OIDC manually.

Angular OIDC config should target the mock IdP:

```ts
authority: 'http://localhost:9000',
clientId: 'angular-demo',
redirectUrl: 'http://localhost:4200/callback',
postLogoutRedirectUri: 'http://localhost:4200',
scope: 'openid profile email api.read',
responseType: 'code',
```

For the PoC, it is acceptable if the Angular browser flow requires clicking a local fake-login page. The key unattended requirement is Gatling/API tests, not full end-to-end browser SSO automation.

Angular must be able to call:

```text
GET http://localhost:8080/api/me
```

with:

```text
Authorization: Bearer <access_token>
```

CORS must be configured in Spring Boot for:

```text
http://localhost:4200
```

---

### 4.4 Gatling demo

Use Gatling to prove unattended protected API testing.

The Gatling simulation must:

1. Start with no human interaction.
2. Obtain an access token from the mock IdP using `client_credentials`.
3. Call `GET /public`.
4. Call `GET /api/me` with bearer token.
5. Call `GET /api/admin` with bearer token.
6. Assert expected status codes.

Minimum scenario:

```text
Scenario: Unattended authenticated API test

1. POST http://localhost:9000/oauth/token
   grant_type=client_credentials
   client_id=gatling-client
   client_secret=gatling-secret
   scope=api.read

2. Extract access_token.

3. GET http://localhost:8080/public
   Expect 200.

4. GET http://localhost:8080/api/me
   Authorization: Bearer ${access_token}
   Expect 200.

5. GET http://localhost:8080/api/admin
   Authorization: Bearer ${access_token}
   Expect 200.
```

Load profile should be tiny:

```text
1 user
1 iteration
```

Optional second profile:

```text
10 users
30 seconds
```

The purpose is proof of unattended auth, not real performance capacity.

---

## 5. Docker Compose

Provide a `docker-compose.yml` that can run:

```text
mock-idp
spring-demo
```

Angular and Gatling may run from the host for simplicity.

Preferred ports:

```text
mock-idp:    9000
spring-demo: 8080
angular:     4200
```

Minimum Compose services:

```yaml
services:
  mock-idp:
    build: ./mock-idp
    ports:
      - "9000:9000"

  spring-demo:
    build: ./spring-demo
    ports:
      - "8080:8080"
    environment:
      SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI: http://mock-idp:9000
```

Important: because browser-based Angular uses `localhost`, but Spring-in-Docker may use `mock-idp`, the implementation must handle issuer URL consistency.

Acceptable solutions:

1. Run Spring locally instead of in Docker for the PoC.
2. Use `host.docker.internal` where appropriate.
3. Configure the mock IdP issuer as `http://localhost:9000` and allow Spring to reach that URL.
4. Document any required host/Docker distinction clearly.

Favor the simplest working setup over perfect container networking.

---

## 6. Required scripts

At repo root, provide scripts or Make targets:

```text
npm run mock-idp
npm run angular
npm run spring
npm run gatling
npm run test:poc
```

`npm run test:poc` should:

1. Start mock IdP.
2. Start Spring Boot API.
3. Wait for health checks.
4. Run Gatling.
5. Exit non-zero on failure.

It is acceptable for `test:poc` to use a small Node script, Bash script, or Docker Compose.

---

## 7. Acceptance criteria

The PoC is successful when a developer can run one command and see authenticated API tests pass without human login.

Required command:

```bash
npm run test:poc
```

Required successful behavior:

```text
Mock IdP starts.
Spring Boot starts.
Gatling obtains a token.
Gatling calls /public and receives 200.
Gatling calls /api/me with bearer token and receives 200.
Gatling calls /api/admin with bearer token and receives 200.
The command exits 0.
```

Angular acceptance criteria:

```text
npm run angular
```

Then:

```text
Open http://localhost:4200
Click login.
Authenticate through mock IdP or fake local login.
Navigate to /protected.
See user claims.
See successful response from Spring Boot /api/me.
```

Angular can be manually verified. It does not need to be part of the unattended Gatling test.

---

## 8. Minimal security requirements

Even though this is a mock, the PoC must avoid unsafe shortcuts that would invalidate the demo.

Must do:

1. Spring Boot must validate JWT signatures.
2. Spring Boot must validate issuer or JWKS.
3. Protected endpoints must reject missing tokens.
4. Protected endpoints must reject invalid tokens.
5. `/api/admin` must enforce a claim-based rule.

Must not do:

1. Do not disable Spring Security.
2. Do not accept unsigned JWTs.
3. Do not hardcode “always authenticated” test users inside Spring.
4. Do not bypass bearer-token validation in Gatling.

---

## 9. Suggested implementation sequence

### Step 1: Mock IdP

Create the Node/TypeScript mock IdP.

Verify manually:

```bash
curl http://localhost:9000/.well-known/openid-configuration
curl http://localhost:9000/.well-known/jwks.json
```

Verify token issuance:

```bash
curl -X POST http://localhost:9000/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=gatling-client \
  -d client_secret=gatling-secret \
  -d scope=api.read
```

### Step 2: Spring Boot API

Create protected endpoints.

Verify:

```bash
curl http://localhost:8080/public
curl http://localhost:8080/api/me
```

The second command must return 401 without a token.

Then call `/api/me` with a mock token and verify 200.

### Step 3: Gatling

Add Gatling simulation.

Verify the token request and protected endpoint calls work unattended.

### Step 4: Angular

Add minimal Angular UI.

Verify browser login and `/api/me` call.

### Step 5: One-command runner

Add root-level `npm run test:poc`.

---

## 10. Notes for implementer

Keep everything boring.

This is a proof of concept for replacing interactive SSO in automated tests. Do not spend time on UI polish, elaborate identity modeling, real IdP compatibility, or high load.

The core proof is:

```text
A signed token from a local mock OIDC server can satisfy the same Spring Boot resource-server validation path that production SSO tokens use.
```

If that works, CI can test protected APIs without a human clicking through SSO.
