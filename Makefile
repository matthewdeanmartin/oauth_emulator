# sso-mock-poc — build, run, and security tasks.
#
# Security scanning targets check every dependency tree for known
# vulnerabilities:
#   make audit         - scan everything (npm + Maven)
#   make audit-npm     - scan the Node projects (mock-idp, angular-demo)
#   make audit-java    - scan the Maven projects (spring-demo, gatling)
#   make audit-osv     - cross-ecosystem scan via OSV-Scanner (if installed)
#
# See docs/usage/security.md for the dependency cooloff policy (.npmrc) and the
# Java cooloff caveat.

.DEFAULT_GOAL := help
MVN ?= mvn
NPM ?= npm

# OWASP Dependency-Check plugin coordinates (no pom changes needed to invoke).
DC_PLUGIN := org.owasp:dependency-check-maven:12.2.2:check
# Fail the build when a CVE at/above this CVSS score is found (0-10).
DC_FAIL_ON_CVSS ?= 7

.PHONY: help
help:
	@echo "Targets:"
	@echo "  make audit        - security scan all dependencies (npm + Maven)"
	@echo "  make audit-npm    - npm audit for mock-idp and angular-demo"
	@echo "  make audit-java   - OWASP Dependency-Check for spring-demo and gatling"
	@echo "  make audit-osv    - OSV-Scanner across the whole repo (if installed)"
	@echo "  make test-poc     - run the unattended Gatling proof"

# --- Security scanning ----------------------------------------------------

.PHONY: audit
audit: audit-npm audit-java
	@echo ""
	@echo ">> Dependency security scan complete."

# npm audit fails (non-zero) when a vulnerability at the given level or above is
# found. 'high' here means: flag high and critical advisories.
.PHONY: audit-npm
audit-npm:
	@echo ">> npm audit: mock-idp"
	cd mock-idp && $(NPM) install --package-lock-only --ignore-scripts && $(NPM) audit --audit-level=high
	@echo ">> npm audit: angular-demo"
	cd angular-demo && $(NPM) install --package-lock-only --ignore-scripts && $(NPM) audit --audit-level=high

# OWASP Dependency-Check downloads/updates the NVD database on first run, which
# is slow and (without an NVD API key) rate-limited. Set NVD_API_KEY to speed it
# up: make audit-java NVD_API_KEY=xxxx
.PHONY: audit-java
audit-java:
	@echo ">> OWASP Dependency-Check: spring-demo"
	$(MVN) -f spring-demo/pom.xml $(DC_PLUGIN) \
		-DfailBuildOnCVSS=$(DC_FAIL_ON_CVSS) $(if $(NVD_API_KEY),-DnvdApiKey=$(NVD_API_KEY),)
	@echo ">> OWASP Dependency-Check: gatling"
	$(MVN) -f gatling/pom.xml $(DC_PLUGIN) \
		-DfailBuildOnCVSS=$(DC_FAIL_ON_CVSS) $(if $(NVD_API_KEY),-DnvdApiKey=$(NVD_API_KEY),)

# Optional lighter alternative: one scanner across npm + Maven lockfiles.
# Install from https://github.com/google/osv-scanner (or: go install ...).
.PHONY: audit-osv
audit-osv:
	@command -v osv-scanner >/dev/null 2>&1 || { \
		echo "osv-scanner not found. Install: https://github.com/google/osv-scanner"; exit 1; }
	osv-scanner scan --recursive .

# --- Convenience ----------------------------------------------------------

.PHONY: test-poc
test-poc:
	$(NPM) run test:poc
