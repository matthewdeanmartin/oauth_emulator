# Troubleshooting

The issues you're actually likely to hit, and what to do about them.

## Gatling fails with `module java.base does not open java.lang`

On Java 17+, Gatling's log writer reflects into JDK internals that are locked
down by default. The fix — `--add-opens java.base/java.lang=ALL-UNNAMED` — is
already in `gatling/pom.xml` as a plugin `jvmArg`. If you run Gatling some other
way (e.g. a bare `java` invocation), add that flag yourself.

## Spring fails to start: can't reach the issuer

Spring validates the `issuer-uri` at **startup** by fetching the discovery
document. If the mock IdP isn't running yet, Spring won't start.

- Running by hand? Start `npm run mock-idp` **before** `npm run spring`.
- Using `npm run test:poc`? It already waits for the mock's health check first,
  so this shouldn't happen.

## `/api/me` returns 401 with a token that looks valid

Usually an **issuer mismatch**. The token's `iss` claim must equal Spring's
configured `issuer-uri`, which must equal the discovery doc's `issuer`. This is
the classic Docker trap — see the
**[issuer-consistency caveat](usage/docker.md#the-issuer-consistency-caveat)**.

Check the token's `iss`:

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/login -d username=demo.user \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null
```

The `iss` there must match `application.yml`'s `issuer-uri`.

## `/api/admin` returns 403 for a user I expect to be admin

`/api/admin` requires the `admin` entry in the token's `groups` claim. `demo.user`
has it; `plain.user` does not. Confirm which user you minted the token for, and
check the `groups` claim in the decoded token (command above).

## Angular login fails: `token(s) validation failed, resetting`

The OIDC client rejected the ID token. This happens if the ID token's audience
isn't the `client_id`, or the `nonce` isn't echoed back. The mock handles both
(see **[Two tokens, two audiences](overview/how-it-works.md#two-tokens-two-audiences)**).
If you've modified the mock, make sure `/oauth/token` still returns a separate
`id_token` with `aud=<client_id>` and the original `nonce`.

## Angular login button does nothing / stays on `/login`

The OIDC library needs the discovery document loaded before `authorize()` will
redirect. Give the page a moment after load before clicking, and confirm the mock
IdP is reachable at `http://localhost:9000` from the browser (open the discovery
URL directly).

## Ports already in use (9000 / 8080 / 4200)

A previous run may not have shut down cleanly. Find and kill the listener:

```bash
# Git Bash on Windows
netstat -ano | grep ":9000 " | grep LISTENING
taskkill //PID <pid> //T //F
```

`npm run test:poc` tears down its own services on exit; if it was interrupted
hard (e.g. killed mid-run), you may need to clean up manually.

## First build is slow

The first `npm run build` / `npm run gatling` downloads Maven and Gatling
dependencies into your local `~/.m2` repository. Subsequent runs are fast.
