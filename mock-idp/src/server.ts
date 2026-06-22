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
//
// The /login endpoint is the one Gatling uses: no human, no redirects.

import express, { Request, Response } from "express";
import {
  exportJWK,
  generateKeyPair,
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
let publicJwk: JWK;

async function initKeys(): Promise<void> {
  const { privateKey: priv, publicKey: pub } = await generateKeyPair("RS256", {
    extractable: true,
  });
  privateKey = priv;
  publicJwk = {
    ...(await exportJWK(pub)),
    kid: KEY_ID,
    use: "sig",
    alg: "RS256",
  };
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

// --- Health ---------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ status: "UP" }));

initKeys().then(() => {
  app.listen(PORT, () => {
    console.log(`mock-idp listening on ${ISSUER}`);
    console.log(`  discovery: ${ISSUER}/.well-known/openid-configuration`);
    console.log(`  jwks:      ${ISSUER}/.well-known/jwks.json`);
    console.log(`  login:     POST ${ISSUER}/login  (unattended)`);
  });
});
