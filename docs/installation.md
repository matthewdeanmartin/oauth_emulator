# Installation

`sso-mock-poc` is a single repository with four sub-projects. There is nothing to
publish or globally install — you clone it and run it.

## Prerequisites

| Tool        | Version     | Used by                          |
|-------------|-------------|----------------------------------|
| Node.js     | 20+         | mock-idp, Angular                |
| npm         | bundled     | scripts, dependency install      |
| Java (JDK)  | 21          | Spring, Gatling                  |
| Maven       | 3.9+        | Spring build, Gatling run        |
| Docker      | optional    | `docker compose` path            |

Check what you have:

```bash
node --version
java -version
mvn --version
```

> **Java note.** Gatling needs `--add-opens java.base/java.lang=ALL-UNNAMED` on
> Java 17+. This is already configured in `gatling/pom.xml`, so you don't pass it
> yourself — but it's why the Gatling plugin has a `jvmArgs` block.

## First build

From the repository root:

```bash
npm run build
```

This installs the mock IdP's npm dependencies and packages the Spring app
(`mvn -DskipTests package`). The first run also downloads Maven and Gatling
dependencies, so it can take a few minutes; subsequent runs are fast.

The Angular app's dependencies are installed separately the first time you use
it:

```bash
npm --prefix angular-demo install
```

## Verify

Run the unattended proof:

```bash
npm run test:poc
```

You should see `BUILD SUCCESS`, four Gatling requests all `OK`, and an exit code
of `0`. If it doesn't, see **[Troubleshooting](troubleshooting.md)**.

## Next

Head to the **[Quick Start](usage/quickstart.md)** to run each piece by hand and
watch the auth flow.
