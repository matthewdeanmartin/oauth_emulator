# Dependency Security

Two distinct supply-chain defenses live in this repo:

1. **Vulnerability scanning** — does any installed dependency have a *known* CVE?
2. **Install cooloff** — refuse to install package versions published in the last
   couple of days, to dodge freshly-compromised releases before they're caught.

## Vulnerability scanning

Run via the `Makefile`:

```bash
make audit         # scan everything (npm + Maven)
make audit-npm     # just the Node projects (mock-idp, angular-demo)
make audit-java    # just the Maven projects (spring-demo, gatling)
make audit-osv     # optional: OSV-Scanner across the whole repo
```

### npm (`make audit-npm`)

Uses the built-in `npm audit` against `mock-idp` and `angular-demo`. The target
runs with `--audit-level=high`, so it **exits non-zero** when a high- or
critical-severity advisory is present anywhere in the dependency tree (including
transitive deps). That makes it CI-gating.

### Maven (`make audit-java`)

Uses the [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/)
plugin, invoked by coordinates so no `pom.xml` changes are needed. It fails the
build on any CVE with CVSS ≥ 7 (override with `DC_FAIL_ON_CVSS`).

> **First run is slow.** Dependency-Check downloads the NVD vulnerability
> database on first use, and without an API key the NVD rate-limits you. Get a
> free key at <https://nvd.nist.gov/developers/request-an-api-key> and pass it:
>
> ```bash
> make audit-java NVD_API_KEY=xxxxxxxx
> ```

### OSV-Scanner (`make audit-osv`, optional)

A single Google [OSV-Scanner](https://github.com/google/osv-scanner) pass covers
both npm and Maven lockfiles and is much faster than Dependency-Check. It isn't
bundled — install it first, then `make audit-osv`.

## Install cooloff (dependency age gate)

A cooloff refuses to install any dependency version published more recently than
a threshold. Most malicious package versions are detected and yanked within
hours, so even a short delay sidesteps the danger window.

### npm — done locally, no global config

The repo ships a project-scoped **`.npmrc`** at the root:

```ini
min-release-age=2
```

`min-release-age` is the number of **days**; `2` means npm will only install
versions that have been public for at least two days, transitive deps included.
This is a per-project file — **no global/machine config is required** — and npm
applies it to the `mock-idp/` and `angular-demo/` subprojects too, because npm
walks up the directory tree to find `.npmrc`.

**Requirements & notes:**

- Needs **npm ≥ 11.10.0** (the feature shipped Feb 2026). Older npm silently
  ignores the key. Check with `npm --version`.
- If a legitimate, just-published version is ever blocked, exempt it in
  `.npmrc`:

  ```ini
  min-release-age-exclude[]=some-package
  min-release-age-exclude[]=@myorg/*
  ```

- Equivalent settings exist for other managers if you switch:
  `pnpm` → `minimumReleaseAge` (minutes) in `pnpm-workspace.yaml`;
  `yarn` (Berry 4.10+) → `npmMinimalAgeGate` (minutes) in `.yarnrc.yml`;
  `bun` (1.3+) → `minimumReleaseAge` in `bunfig.toml`.

### Java / Maven — not possible locally; do it at the infrastructure layer

**There is no Maven-native equivalent of `min-release-age`.** Maven Central has
no per-build "minimum release age" gate, and neither the Maven CLI nor the
`pom.xml` can express "don't resolve artifacts newer than N days." So for the
`spring-demo` and `gatling` modules, the cooloff has to be enforced *outside* the
local build. The realistic options:

1. **A repository manager proxy (recommended for teams).** Front Maven Central
   with [Sonatype Nexus](https://help.sonatype.com/) or
   [JFrog Artifactory] and configure a *staging/quarantine* or release-age policy
   on the proxy repository, then point Maven at it via `settings.xml`
   (`<mirror>`). Builds only ever see artifacts the proxy has aged-in. This is
   the only way to get true install-time cooloff for Maven.

2. **Gate updates, not installs.** Pin exact versions (this repo already pins
   the Spring Boot parent, Gatling, and plugin versions) and let a bot like
   [Renovate](https://docs.renovatebot.com/configuration-options/#minimumreleaseage)
   propose upgrades with a `minimumReleaseAge` setting. Renovate won't open a PR
   bumping a dependency until the new version has aged the configured amount.
   Combined with pinned versions, your builds never pull a brand-new artifact
   without that PR.

3. **Scan on every build (already provided).** `make audit-java` won't *prevent*
   installing a fresh version, but it catches a published-and-known-bad
   dependency. Cooloff and scanning are complementary, not substitutes.

If you don't run a repository manager, option 2 (pinned versions + Renovate
`minimumReleaseAge`) is the closest local-ish approximation: nothing new enters
the build except through an aged, reviewed PR.

## Summary

| Defense              | npm                              | Java / Maven                          |
|----------------------|----------------------------------|---------------------------------------|
| Vulnerability scan   | `make audit-npm` (`npm audit`)   | `make audit-java` (OWASP DC)          |
| Install cooloff      | ✅ `.npmrc` `min-release-age=2`  | ❌ not local — proxy or Renovate (see above) |
