// Minimal mock OIDC / SSO server for unattended auth tests.
//
// Real-world model this emulates:
//   1. A user signs in at the SSO server and receives a signed JWT.
//   2. The user sends that JWT to a backend API as a Bearer token.
//   3. The backend (Spring resource server) validates the JWT's signature and
//      issuer against this server's published JWKS / discovery document.
//
// This is NOT server-to-server client_credentials. The token represents a
// logged-in human. For unattended tests, "signing in" is just hitting a login
// endpoint that mints the JWT with no password prompt.
//
// Endpoints:
//   GET  /.well-known/openid-configuration   discovery doc
//   GET  /.well-known/jwks.json              public signing key (JWKS)
//   GET  /oauth/authorize                    fake interactive login page (browser)
//   POST /oauth/token                        OIDC-ish token endpoint (auth code)
//   POST /login                              unattended: mint a JWT for a user
//   GET  /userinfo                           OIDC call-home: current claims / 401
//   POST /introspect                         RFC 7662 call-home: {active, claims}
//   POST /admin/revoke|restore|set-groups    flip a user's governance state
//
// The /login endpoint is the one Gatling uses: no human, no redirects.
//
// Why /userinfo + /introspect exist:
//   A JWT is a *snapshot* taken when the user signed in. Some apps re-check the
//   identity source mid-session ("has this user been fired or lost their role in
//   the last 5 minutes?") because the token, though still unexpired and
//   signature-valid, may be stale. That authoritative source is typically an IGA
//   system like some oauth server. This mock stands in for it: the app is
//   configured with a userinfo URL and/or an introspection URL, points them at
//   these endpoints, and the /admin/* endpoints let a test flip a user to
//   "revoked" so the call-home starts rejecting an otherwise-valid token.

import express, { Request, Response } from "express";
import {
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  JWK,
  KeyLike,
} from "jose";
import { USERS, DEFAULT_USERNAME } from "./users.js";

const PORT = Number(process.env.PORT ?? 9000);
const ISSUER = process.env.ISSUER ?? `http://localhost:${PORT}`;
const AUDIENCE = process.env.AUDIENCE ?? "spring-demo-api";
const KEY_ID = "mock-idp-key-1";
const TOKEN_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Signing key. Generated once at startup; stable for the life of the process,
// which is all the PoC needs. JWKS exposes only the public half.
// ---------------------------------------------------------------------------
let privateKey: KeyLike;
let publicKey: KeyLike; // kept for local token verification (userinfo/introspect)
let publicJwk: JWK;

async function initKeys(): Promise<void> {
  const { privateKey: priv, publicKey: pub } = await generateKeyPair("RS256", {
    extractable: true,
  });
  privateKey = priv;
  publicKey = pub;
  publicJwk = {
    ...(await exportJWK(pub)),
    kid: KEY_ID,
    use: "sig",
    alg: "RS256",
  };
}

/**
 * Verifies a token this mock issued (signature + issuer + expiry) and returns
 * its claims. Throws if the token is malformed, tampered, wrong-issuer, or
 * expired. Note: this checks the CRYPTOGRAPHIC validity only — it says nothing
 * about whether the user has since been revoked. That governance check is
 * layered on top by the callers (userinfo/introspect) via the `revoked` flag.
 */
async function verifyToken(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER });
  return payload as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Token minting. Builds the JWT claims for a given user per the spec.
// ---------------------------------------------------------------------------
async function mintAccessToken(username: string): Promise<string> {
  const user = USERS[username];
  if (!user) {
    throw new Error(`unknown user: ${username}`);
  }

  return new SignJWT({
    preferred_username: user.preferred_username,
    email: user.email,
    name: user.name,
    scope: "openid profile email api.read",
    groups: user.groups,
  })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

/**
 * Mints an OIDC id_token. Unlike the access token, its audience is the OIDC
 * client_id (what the Angular OIDC library validates), and it echoes the nonce
 * supplied at /oauth/authorize so the library's replay check passes.
 */
async function mintIdToken(
  username: string,
  clientId: string,
  nonce: string | undefined
): Promise<string> {
  const user = USERS[username];
  if (!user) {
    throw new Error(`unknown user: ${username}`);
  }
  const builder = new SignJWT({
    preferred_username: user.preferred_username,
    email: user.email,
    name: user.name,
    groups: user.groups,
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(clientId)
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`);
  return builder.sign(privateKey);
}

/** Encode/decode the auth code: carries username + client_id + nonce. */
function encodeCode(payload: { u: string; c: string; n?: string }): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
function decodeCode(code: string): { u: string; c: string; n?: string } | null {
  try {
    return JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Permissive CORS so the browser Angular app can hit discovery/jwks directly.
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

// --- Discovery ------------------------------------------------------------
app.get("/.well-known/openid-configuration", (_req: Request, res: Response) => {
  res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    introspection_endpoint: `${ISSUER}/introspect`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "api.read"],
    token_endpoint_auth_methods_supported: ["none"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
});

// --- JWKS -----------------------------------------------------------------
app.get("/.well-known/jwks.json", (_req: Request, res: Response) => {
  res.json({ keys: [publicJwk] });
});

// --- Unattended login: mint a JWT for a user, no password ------------------
// This is the endpoint Gatling calls. Returns an OAuth-style token response.
//   POST /login  { username?: "demo.user" }   (form or json)
app.post("/login", async (req: Request, res: Response) => {
  const username = String(
    req.body?.username ?? req.query.username ?? DEFAULT_USERNAME
  );
  if (!USERS[username]) {
    return res.status(400).json({
      error: "invalid_user",
      error_description: `unknown user '${username}'`,
      known_users: Object.keys(USERS),
    });
  }
  const token = await mintAccessToken(username);
  res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: "openid profile email api.read",
  });
});

// --- Fake interactive login page (for the Angular browser demo) ------------
// Renders a trivial page that lets a human pick a user and "sign in", then
// redirects back to the app with an auth code. The code encodes the username.
app.get("/oauth/authorize", (req: Request, res: Response) => {
  const redirectUri = String(req.query.redirect_uri ?? "");
  const state = String(req.query.state ?? "");
  const clientId = String(req.query.client_id ?? "angular-demo");
  const nonce = req.query.nonce ? String(req.query.nonce) : undefined;
  const buttons = Object.keys(USERS)
    .map((u) => {
      const code = encodeCode({ u, c: clientId, n: nonce });
      const url = `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}`;
      return `<li><a href="${url}">Sign in as <b>${u}</b></a></li>`;
    })
    .join("\n");
  res.type("html").send(
    `<!doctype html><html><head><title>Mock SSO Login</title></head>
     <body style="font-family:sans-serif;max-width:480px;margin:40px auto">
       <h1>Mock SSO</h1>
       <p>Pick a test identity to sign in (no password — this is a mock):</p>
       <ul>${buttons}</ul>
     </body></html>`
  );
});

// --- Token endpoint (authorization_code) for the browser flow --------------
// Accepts the code minted by /oauth/authorize and returns tokens.
app.post("/oauth/token", async (req: Request, res: Response) => {
  const grantType = String(req.body?.grant_type ?? "");
  if (grantType !== "authorization_code") {
    return res
      .status(400)
      .json({ error: "unsupported_grant_type", supported: ["authorization_code"] });
  }
  const code = String(req.body?.code ?? "");
  const decoded = decodeCode(code);
  if (!decoded || !USERS[decoded.u]) {
    return res.status(400).json({ error: "invalid_grant" });
  }
  const accessToken = await mintAccessToken(decoded.u);
  const idToken = await mintIdToken(decoded.u, decoded.c, decoded.n);
  res.json({
    access_token: accessToken,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: "openid profile email api.read",
  });
});

// --- Call-home: OIDC UserInfo ---------------------------------------------
// GET /userinfo  (Authorization: Bearer <access_token>)
//
// The app calls this mid-session to re-check the user against the live identity
// source. Returns the user's CURRENT claims. If the token is invalid/expired ->
// 401. If the user has since been revoked (fired) -> 401 with an error that
// signals the session should end, even though the JWT itself is still valid.
async function handleUserInfo(req: Request, res: Response): Promise<Response> {
  const auth = req.header("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token) {
    return res
      .status(401)
      .set("WWW-Authenticate", 'Bearer error="invalid_request"')
      .json({ error: "invalid_request", error_description: "missing bearer token" });
  }

  let claims: Record<string, unknown>;
  try {
    claims = await verifyToken(token);
  } catch (e) {
    return res
      .status(401)
      .set("WWW-Authenticate", 'Bearer error="invalid_token"')
      .json({ error: "invalid_token", error_description: (e as Error).message });
  }

  const username = String(claims.preferred_username ?? "");
  const user = USERS[username];
  // User deleted from the directory, or governance-revoked since the token was
  // minted: the token is cryptographically fine but the session is no longer
  // authorized. This is the "fired 5 minutes ago" case.
  if (!user || user.revoked) {
    return res
      .status(401)
      .set("WWW-Authenticate", 'Bearer error="invalid_token"')
      .json({
        error: "invalid_token",
        error_description: "user is no longer active (revoked/deprovisioned)",
      });
  }

  // Return CURRENT claims (groups may have changed since the token was minted).
  return res.json({
    sub: user.sub,
    preferred_username: user.preferred_username,
    email: user.email,
    name: user.name,
    groups: user.groups,
  });
}
app.get("/userinfo", handleUserInfo);
// PingFederate-style alias, in case the app is configured with that path.
app.get("/idp/userinfo.openid", handleUserInfo);

// --- Call-home: OAuth2 Token Introspection (RFC 7662) ----------------------
// POST /introspect   token=<access_token>
//
// Confidential-client style call-home. Returns {active:true, ...current claims}
// while the user is valid, or {active:false} once revoked/expired/invalid. Per
// RFC 7662 an inactive or unverifiable token is reported as {active:false} with
// HTTP 200 (not an error). Client auth is accepted but not enforced here — this
// is a mock; see the note on client_secret in the README.
async function handleIntrospect(req: Request, res: Response): Promise<Response> {
  const token = String(req.body?.token ?? "");
  if (!token) {
    return res.status(400).json({ error: "invalid_request" });
  }

  let claims: Record<string, unknown>;
  try {
    claims = await verifyToken(token);
  } catch {
    return res.json({ active: false });
  }

  const username = String(claims.preferred_username ?? "");
  const user = USERS[username];
  if (!user || user.revoked) {
    return res.json({ active: false });
  }

  return res.json({
    active: true,
    sub: user.sub,
    username: user.preferred_username,
    preferred_username: user.preferred_username,
    email: user.email,
    name: user.name,
    groups: user.groups, // CURRENT groups — reflects any role change
    scope: String(claims.scope ?? ""),
    token_type: "Bearer",
    exp: claims.exp,
    iat: claims.iat,
    iss: claims.iss,
    aud: claims.aud,
  });
}
app.post("/introspect", handleIntrospect);
// PingFederate-style alias.
app.post("/as/introspection.oauth2", handleIntrospect);

// --- Admin: mutate governance state (emulate some oauth server changes) ---------
// These have no auth on purpose: they are a test control surface for the mock,
// standing in for "an admin deprovisioned this user in IdentityIQ".
//
//   POST /admin/revoke      { username }          -> user's call-homes fail
//   POST /admin/restore     { username }          -> re-activate
//   POST /admin/set-groups  { username, groups }  -> change roles mid-session
function findUsername(req: Request): string {
  return String(req.body?.username ?? req.query.username ?? "");
}

app.post("/admin/revoke", (req: Request, res: Response) => {
  const username = findUsername(req);
  const user = USERS[username];
  if (!user) return res.status(404).json({ error: "unknown_user", username });
  user.revoked = true;
  console.log(`[admin] revoked ${username} (fired / deprovisioned)`);
  return res.json({ username, revoked: true });
});

app.post("/admin/restore", (req: Request, res: Response) => {
  const username = findUsername(req);
  const user = USERS[username];
  if (!user) return res.status(404).json({ error: "unknown_user", username });
  user.revoked = false;
  console.log(`[admin] restored ${username}`);
  return res.json({ username, revoked: false });
});

app.post("/admin/set-groups", (req: Request, res: Response) => {
  const username = findUsername(req);
  const user = USERS[username];
  if (!user) return res.status(404).json({ error: "unknown_user", username });
  const groups = req.body?.groups;
  if (!Array.isArray(groups) || !groups.every((g) => typeof g === "string")) {
    return res
      .status(400)
      .json({ error: "invalid_groups", error_description: "groups must be a string array" });
  }
  user.groups = groups;
  console.log(`[admin] set ${username} groups -> ${JSON.stringify(groups)}`);
  return res.json({ username, groups });
});

// --- Health ---------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ status: "UP" }));

initKeys().then(() => {
  app.listen(PORT, () => {
    console.log(`mock-idp listening on ${ISSUER}`);
    console.log(`  discovery: ${ISSUER}/.well-known/openid-configuration`);
    console.log(`  jwks:      ${ISSUER}/.well-known/jwks.json`);
    console.log(`  login:     POST ${ISSUER}/login  (unattended)`);
    console.log(`  userinfo:  GET  ${ISSUER}/userinfo   (call-home)`);
    console.log(`  introspect:POST ${ISSUER}/introspect (call-home)`);
    console.log(`  admin:     POST ${ISSUER}/admin/{revoke,restore,set-groups}`);
  });
});
