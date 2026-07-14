#!/usr/bin/env node
// Live, online end-to-end demo of the JWT + identity-emulator flow.
//
// Unlike test-poc.mjs (which runs Gatling), this script narrates each step so a
// human can *see* the token being minted by the mock IdP and then validated
// online by the Spring resource server:
//
//   1. Start the mock IdP (Node)   -> the identity emulator.
//   2. Start the Spring Boot API   -> the resource server.
//   3. Wait for both health checks.
//   4. POST /login to the mock IdP -> mint a signed JWT (no password).
//   5. Decode + print the JWT claims (header + payload) so you can read them.
//   6. GET  8080/api/me   with the bearer token -> Spring validates it LIVE
//      (signature via the mock's JWKS + issuer + expiry) and echoes the claims.
//   7. GET  8080/api/admin as demo.user (admin group) -> 200.
//   8. GET  8080/api/admin as plain.user (no admin)   -> 403, proving the
//      claim-based rule is real.
//   9. GET  8080/api/me with NO token -> 401, proving auth is genuine.
//  10. Tear everything down.
//
// Then it demonstrates the CALL-HOME scenario this PoC exists for: an app that
// re-checks the identity source mid-session ("has this user been fired or lost
// a role since the JWT was minted?"). It calls the mock's /userinfo and
// /introspect endpoints (which stand in for some oauth server lookup),
// revokes the user via /admin/revoke, and shows the SAME still-unexpired JWT now
// getting rejected by the call-home — while Spring's OFFLINE validation still
// accepts it, which is exactly why the online recheck is necessary.
//
// Two different validations are at play, on purpose:
//   * Spring resource server -> OFFLINE JWT check (signature + issuer + expiry).
//     Cannot see a revoke; a valid unexpired token always passes.
//   * App call-home to /userinfo|/introspect -> ONLINE check against live state.
//     Reflects revoke / role change immediately.
//
// No client secret exists: the mock models a public client (auth_method
// "none"); /login needs no client_id, and /introspect accepts but does not
// enforce client credentials (it's a mock).

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const IS_WIN = process.platform === "win32";
const npmCmd = IS_WIN ? "npm.cmd" : "npm";
const mvnCmd = IS_WIN ? "mvn.cmd" : "mvn";

const IDP = "http://localhost:9000";
const API = "http://localhost:8080";
const IDP_HEALTH = `${IDP}/health`;
const API_HEALTH = `${API}/actuator/health`;

// Set DEMO_NO_START=1 to run the checks against services you already started
// (e.g. `npm run mock-idp` + `npm run spring` in other terminals).
const NO_START = process.env.DEMO_NO_START === "1";

const children = [];

function start(name, cmd, args, opts = {}) {
  console.log(`\n[demo] starting ${name}: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: IS_WIN, // needed for .cmd resolution on Windows
    ...opts,
  });
  child.on("exit", (code) => {
    if (code && code !== 0 && !shuttingDown) {
      console.error(`[demo] ${name} exited early with code ${code}`);
    }
  });
  children.push({ name, child });
  return child;
}

async function waitForHealth(name, url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`[demo] waiting for ${name} health (${url}) `);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log("-> UP");
        return;
      }
    } catch {
      /* not up yet */
    }
    process.stdout.write(".");
    await sleep(1000);
  }
  console.log("");
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms`);
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (NO_START) return;
  console.log("\n[demo] shutting down services...");
  for (const { name, child } of children) {
    try {
      if (IS_WIN) {
        // Kill the whole process tree (mvn -> java, npm -> node).
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          shell: true,
        });
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch (e) {
      console.error(`[demo] failed to stop ${name}: ${e.message}`);
    }
  }
}

process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("SIGTERM", () => { shutdown(); process.exit(143); });

// --- small helpers ---------------------------------------------------------

/** Decode a JWT's header + payload (no verification — display only). */
function decodeJwt(token) {
  const [h, p] = token.split(".");
  const b64 = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  return { header: b64(h), payload: b64(p) };
}

/** Pretty JSON on one indented block. */
function show(obj) {
  return JSON.stringify(obj, null, 2)
    .split("\n")
    .map((l) => "      " + l)
    .join("\n");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mint an access token for a user via the mock IdP's unattended /login. */
async function login(username) {
  const res = await fetch(`${IDP}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const body = await res.json();
  assert(res.ok, `/login for ${username} failed: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

/** Call an API endpoint, optionally with a bearer token. Returns {status, body}. */
async function callApi(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Call-home: OIDC UserInfo with the user's bearer token. {status, body}. */
async function userinfo(token) {
  const res = await fetch(`${IDP}/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Call-home: OAuth2 introspection (RFC 7662). Returns the JSON body. */
async function introspect(token) {
  const res = await fetch(`${IDP}/introspect`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return res.json();
}

/** Admin control: flip a user's governance state on the mock IdP. */
async function adminAction(action, payload) {
  const res = await fetch(`${IDP}/admin/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  assert(res.ok, `/admin/${action} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// --- the demo --------------------------------------------------------------

async function runChecks() {
  console.log("\n========================================================");
  console.log(" Online JWT + identity-emulator check");
  console.log("========================================================");

  // 1. Mint a token for the admin user.
  console.log("\n[demo] 1. minting a JWT for 'demo.user' via POST " + IDP + "/login");
  const adminToken = await login("demo.user");
  console.log("      access_token (truncated): " + adminToken.slice(0, 32) + "...");

  // 2. Decode + show the claims so the reader can see what's inside.
  console.log("\n[demo] 2. decoding the JWT (display only, not verification):");
  const decoded = decodeJwt(adminToken);
  console.log("   header:");
  console.log(show(decoded.header));
  console.log("   payload (claims):");
  console.log(show(decoded.payload));
  console.log(
    "      note: iss=" + decoded.payload.iss + " must match Spring's issuer-uri;"
  );
  console.log("      groups=" + JSON.stringify(decoded.payload.groups) + " drives the admin rule.");

  // 3. Spring validates the token LIVE and echoes the claims.
  console.log("\n[demo] 3. GET " + API + "/api/me  (Spring validates the JWT online)");
  const me = await callApi("/api/me", adminToken);
  console.log("      -> HTTP " + me.status);
  console.log(show(me.body));
  assert(me.status === 200, `expected 200 from /api/me, got ${me.status}`);

  // 4. Admin endpoint with an admin token -> 200.
  console.log("\n[demo] 4. GET " + API + "/api/admin as demo.user (in group 'admin')");
  const adminResp = await callApi("/api/admin", adminToken);
  console.log("      -> HTTP " + adminResp.status);
  console.log(show(adminResp.body));
  assert(adminResp.status === 200, `expected 200 from /api/admin, got ${adminResp.status}`);

  // 5. Admin endpoint with a non-admin token -> 403 (real claim-based rule).
  console.log("\n[demo] 5. GET " + API + "/api/admin as plain.user (NOT in group 'admin')");
  const plainToken = await login("plain.user");
  const denied = await callApi("/api/admin", plainToken);
  console.log("      -> HTTP " + denied.status + " (expected 403 — the rule is genuine)");
  assert(denied.status === 403, `expected 403 from /api/admin, got ${denied.status}`);

  // 6. No token -> 401 (auth is not disabled).
  console.log("\n[demo] 6. GET " + API + "/api/me with NO token");
  const anon = await callApi("/api/me", null);
  console.log("      -> HTTP " + anon.status + " (expected 401 — Spring Security is real)");
  assert(anon.status === 401, `expected 401 from /api/me, got ${anon.status}`);

  // -----------------------------------------------------------------------
  // The call-home scenario: re-check the identity source mid-session.
  // "Has this user been fired or lost their role since the JWT was minted?"
  // The JWT below stays cryptographically valid and unexpired the WHOLE time.
  // -----------------------------------------------------------------------
  console.log("\n--------------------------------------------------------");
  console.log(" Call-home: online recheck against the identity emulator");
  console.log(" (JWT is reused unchanged throughout — proving the token is");
  console.log("  still signature-valid + unexpired, yet access is withdrawn)");
  console.log("--------------------------------------------------------");

  // 7. UserInfo call-home while the user is still active -> 200 current claims.
  console.log("\n[demo] 7. GET " + IDP + "/userinfo with demo.user's token (still employed)");
  const ui1 = await userinfo(adminToken);
  console.log("      -> HTTP " + ui1.status);
  console.log(show(ui1.body));
  assert(ui1.status === 200, `expected 200 from /userinfo, got ${ui1.status}`);

  // 8. Introspection call-home while active -> active:true.
  console.log("\n[demo] 8. POST " + IDP + "/introspect with the same token");
  const in1 = await introspect(adminToken);
  console.log("      -> " + JSON.stringify({ active: in1.active, groups: in1.groups }));
  assert(in1.active === true, `expected active:true, got ${JSON.stringify(in1)}`);

  // 9. SIMULATE THE FIRING: revoke the user in the identity emulator.
  console.log("\n[demo] 9. *** some oauth server event: demo.user is fired ***");
  console.log("      POST " + IDP + "/admin/revoke  {username: 'demo.user'}");
  await adminAction("revoke", { username: "demo.user" });
  console.log("      -> user revoked. The JWT is NOT changed or re-issued.");

  // 10. UserInfo call-home now -> 401, even though the JWT is still valid.
  console.log("\n[demo] 10. GET " + IDP + "/userinfo with the SAME (unexpired) token");
  const ui2 = await userinfo(adminToken);
  console.log("      -> HTTP " + ui2.status + " (expected 401 — user no longer active)");
  console.log(show(ui2.body));
  assert(ui2.status === 401, `expected 401 from /userinfo after revoke, got ${ui2.status}`);

  // 11. Introspection call-home now -> active:false.
  console.log("\n[demo] 11. POST " + IDP + "/introspect with the same token");
  const in2 = await introspect(adminToken);
  console.log("      -> " + JSON.stringify(in2) + " (expected active:false)");
  assert(in2.active === false, `expected active:false after revoke, got ${JSON.stringify(in2)}`);

  // 12. Proof the JWT itself is still cryptographically fine: Spring (which does
  //     OFFLINE validation and knows nothing about the revoke) still accepts it.
  //     This is exactly WHY the call-home is needed.
  console.log("\n[demo] 12. GET " + API + "/api/me with the same token (Spring offline-validates)");
  const meAfter = await callApi("/api/me", adminToken);
  console.log("      -> HTTP " + meAfter.status + " (still 200! Spring can't see the revoke —");
  console.log("         this is precisely why the app must call home to /userinfo or /introspect)");
  assert(meAfter.status === 200, `expected 200 from /api/me (offline), got ${meAfter.status}`);

  // 13. Role change mid-session: strip 'admin', re-check reflects it live.
  console.log("\n[demo] 13. *** IIQ event: demo.user loses the 'admin' role ***");
  await adminAction("restore", { username: "demo.user" }); // re-activate first
  await adminAction("set-groups", { username: "demo.user", groups: ["demo-users"] });
  console.log("      restored + set-groups -> ['demo-users'] (no longer admin)");
  const in3 = await introspect(adminToken);
  console.log("      POST /introspect -> groups now: " + JSON.stringify(in3.groups));
  assert(
    in3.active === true && !in3.groups.includes("admin"),
    `expected active with admin removed, got ${JSON.stringify(in3)}`
  );
  console.log("      -> the app would re-evaluate access with the CURRENT role set.");

  // Restore original state so re-runs / other tests aren't affected.
  await adminAction("set-groups", { username: "demo.user", groups: ["demo-users", "admin"] });

  console.log("\n========================================================");
  console.log(" All checks passed:");
  console.log("   - mock IdP minted a signed JWT");
  console.log("   - Spring validated it online (signature via JWKS + issuer)");
  console.log("   - admin claim rule enforced (200 admin / 403 non-admin)");
  console.log("   - missing token rejected (401)");
  console.log("   Call-home (the point of THIS PoC):");
  console.log("   - /userinfo + /introspect confirm a live user");
  console.log("   - after revoke, same unexpired JWT -> 401 / active:false");
  console.log("   - Spring's OFFLINE check still 200s the token (why call-home matters)");
  console.log("   - role change reflected live in the call-home response");
  console.log("========================================================");
}

async function main() {
  if (!NO_START) {
    start("mock-idp", npmCmd, ["--prefix", "mock-idp", "run", "dev"]);
    await waitForHealth("mock-idp", IDP_HEALTH);

    start("spring-demo", mvnCmd, ["-f", "spring-demo/pom.xml", "-q", "spring-boot:run"]);
    await waitForHealth("spring-demo", API_HEALTH);
  } else {
    console.log("[demo] DEMO_NO_START=1 — using already-running services");
    await waitForHealth("mock-idp", IDP_HEALTH, 10_000);
    await waitForHealth("spring-demo", API_HEALTH, 10_000);
  }

  await runChecks();

  shutdown();
  await sleep(1500);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n[demo] FAILED: ${err.message}`);
  shutdown();
  setTimeout(() => process.exit(1), 1500);
});
