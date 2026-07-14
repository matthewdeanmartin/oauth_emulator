// Canned test users. No password checking here on purpose: this is a mock IdP
// for unattended tests. "Signing in" means selecting one of these identities and
// receiving a signed JWT that represents the logged-in user.

export interface MockUser {
  sub: string;
  preferred_username: string;
  email: string;
  name: string;
  groups: string[];
  // Runtime governance state, mutated by the /admin endpoints to emulate
  // some oauth server deprovisioning event ("this user was fired") happening
  // AFTER a JWT was already minted. The token stays cryptographically valid and
  // unexpired, but a call-home to /userinfo or /introspect reflects this flag.
  revoked?: boolean;
}

export const USERS: Record<string, MockUser> = {
  // Default demo user from the spec. Member of "admin".
  "demo.user": {
    sub: "user-123",
    preferred_username: "demo.user",
    email: "demo.user@example.test",
    name: "Demo User",
    groups: ["demo-users", "admin"],
  },

  // A non-admin user, useful to prove /api/admin returns 403.
  "plain.user": {
    sub: "user-456",
    preferred_username: "plain.user",
    email: "plain.user@example.test",
    name: "Plain User",
    groups: ["demo-users"],
  },
};

export const DEFAULT_USERNAME = "demo.user";
