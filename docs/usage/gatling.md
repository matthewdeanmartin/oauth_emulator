# The Unattended Proof (Gatling)

Gatling is what makes this a *proof*: it obtains a token and calls the protected
API with zero human interaction, and the build fails if any request doesn't
return the expected status.

## What the simulation does

`gatling/src/test/java/com/example/ssopoc/SsoSimulation.java` runs one scenario:

1. **Sign in.** `POST http://localhost:9000/login` with `username=demo.user`,
   and capture `access_token` from the JSON response.
2. **`GET /public`** — expect `200`.
3. **`GET /api/me`** with `Authorization: Bearer ${token}` — expect `200`, and
   assert `subject` is `user-123`.
4. **`GET /api/admin`** with the bearer token — expect `200` (`demo.user` is an
   admin).

A global assertion requires **zero failed requests**, so the Maven build exits
non-zero if anything is off. No token validation is bypassed anywhere — Gatling
only carries the token.

## Running it

With the mock IdP and Spring already running:

```bash
npm run gatling
```

Or as part of the fully-managed run that starts and stops everything for you:

```bash
npm run test:poc
```

Expected output ends with four `OK` requests and `BUILD SUCCESS`:

```text
---- Global Information ---------------------|---Total---|-----OK----|----KO----
> request count                              |         4 |         4 |         0
...
Global: count of failed events is 0.0 : true (actual : 0.0)
[INFO] BUILD SUCCESS
```

## Load profile

The default is the acceptance criterion: **1 user, 1 iteration**. To run a small
load profile instead, pass `users` and `duration` (seconds):

```bash
mvn -f gatling/pom.xml gatling:test \
  -Dgatling.simulationClass=com.example.ssopoc.SsoSimulation \
  -Dusers=10 -Dduration=30
```

With `duration > 0` the simulation injects `users` constant arrivals per second
for `duration` seconds; with `duration = 0` (the default) it runs a single
at-once batch of `users`.

> The purpose is proof of unattended auth, not real performance capacity. Keep
> load tiny.

## Overridable properties

| Property   | Default                  | Meaning                                  |
|------------|--------------------------|------------------------------------------|
| `idp.url`  | `http://localhost:9000`  | Mock IdP base URL                        |
| `api.url`  | `http://localhost:8080`  | Spring API base URL                      |
| `users`    | `1`                      | Number of virtual users                  |
| `duration` | `0`                      | Seconds; `0` means a single iteration    |

Pass them with `-D`, e.g. `-Dapi.url=http://localhost:9090`.

## Reports

Gatling writes an HTML report under `gatling/target/gatling/`. The console prints
the exact path at the end of each run.

## CI usage

Because `npm run test:poc` exits non-zero on any failure and needs no browser, it
drops straight into a CI job:

```yaml
- run: npm run build
- run: npm run test:poc
```
