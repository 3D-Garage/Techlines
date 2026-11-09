import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { createApp } from "../app.js";
import User from "../models/User.js";

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "security-integration-test-secret";

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439012";
const ADMIN_ID = "507f1f77bcf86cd799439013";

async function startApp(t) {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function tokenFor(id, options = { expiresIn: "1h" }) {
  return jwt.sign({ id }, process.env.TOKEN_SECRET, options);
}

function authUser(id = USER_ID, overrides = {}) {
  return {
    _id: id,
    name: "Authenticated User",
    email: "user@example.com",
    isAdmin: false,
    ...overrides,
  };
}

function stubProtectedUsers(t, usersById) {
  const original = User.findById;
  User.findById = (id) => ({
    select: async () => usersById[String(id)] || null,
  });
  t.after(() => {
    User.findById = original;
  });
}

test("security headers and configured CORS origin are returned on real HTTP responses", async (t) => {
  const previousOrigin = process.env.CORS_ORIGIN;
  const previousClientId = process.env.PAYPAL_CLIENT_ID;
  process.env.CORS_ORIGIN = "https://shop.example.test";
  process.env.PAYPAL_CLIENT_ID = "public-client-id";
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigin;
    if (previousClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousClientId;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/paypal/client-id`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-xss-protection"), "0");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://shop.example.test");
});

test("protected endpoints reject missing, malformed and expired JWTs without leaking token internals", async (t) => {
  const baseUrl = await startApp(t);
  const expired = tokenFor(USER_ID, { expiresIn: -1 });

  for (const authorization of [undefined, "Bearer not-a-jwt", `Bearer ${expired}`]) {
    const headers = authorization ? { authorization } : {};
    const response = await fetch(`${baseUrl}/api/users`, { headers });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.match(body.message, /not authorized/i);
    assert.doesNotMatch(JSON.stringify(body), /JsonWebTokenError|TokenExpiredError|stack|secret/i);
  }
});

test("valid JWT reaches authorization and admin-only endpoint rejects a normal user", async (t) => {
  const normalUser = authUser();
  stubProtectedUsers(t, { [USER_ID]: normalUser });
  const baseUrl = await startApp(t);

  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${tokenFor(USER_ID)}` },
  });

  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /admin/i);
});

test("admin-only endpoint accepts an authenticated admin JWT", async (t) => {
  const adminUser = authUser(ADMIN_ID, { isAdmin: true, email: "admin@example.com" });
  stubProtectedUsers(t, { [ADMIN_ID]: adminUser });

  const originalFind = User.find;
  User.find = () => ({
    select: () => ({
      sort: async () => [{ _id: USER_ID, email: "user@example.com", isAdmin: false }],
    }),
  });
  t.after(() => {
    User.find = originalFind;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].email, "user@example.com");
});

test("should reject profile IDOR when a user tries to update another user", async (t) => {
  const originalFindById = User.findById;
  let targetSaved = false;
  const actor = authUser(USER_ID);
  const target = {
    ...authUser(OTHER_USER_ID, { email: "other@example.com" }),
    save: async function () {
      targetSaved = true;
      return this;
    },
  };

  User.findById = (id) => {
    if (String(id) === USER_ID) {
      return { select: async () => actor };
    }
    if (String(id) === OTHER_USER_ID) {
      return target;
    }
    return null;
  };
  t.after(() => {
    User.findById = originalFindById;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/users/profile/${OTHER_USER_ID}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${tokenFor(USER_ID)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Attacker-controlled name" }),
  });

  assert.equal(response.status, 403);
  assert.equal(targetSaved, false);
});

test("should reject order-history IDOR across users", async (t) => {
  const actor = authUser(USER_ID);
  stubProtectedUsers(t, { [USER_ID]: actor });
  const baseUrl = await startApp(t);

  const response = await fetch(`${baseUrl}/api/users/${OTHER_USER_ID}`, {
    headers: { authorization: `Bearer ${tokenFor(USER_ID)}` },
  });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, "Orders not found.");
});

test("successful login returns a verifiable JWT and required login fields are validated", async (t) => {
  const originalFindOne = User.findOne;
  const fakeUser = {
    _id: USER_ID,
    name: "Login User",
    email: "login@example.com",
    isAdmin: false,
    createdAt: new Date().toISOString(),
    matchPasswords: async (password) => password === "correct-password",
  };
  User.findOne = async ({ email }) => (email === fakeUser.email ? fakeUser : null);
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  const success = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fakeUser.email, password: "correct-password" }),
  });
  const successBody = await success.json();

  assert.equal(success.status, 200);
  assert.ok(successBody.token);
  assert.equal(jwt.verify(successBody.token, process.env.TOKEN_SECRET).id, USER_ID);

  const missing = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fakeUser.email }),
  });
  assert.equal(missing.status, 400);
});

test("duplicate registration and missing registration fields are rejected", async (t) => {
  const originalFindOne = User.findOne;
  User.findOne = async ({ email }) => (email === "duplicate@example.com" ? { _id: USER_ID, email } : null);
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  const duplicate = await fetch(`${baseUrl}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Duplicate",
      email: "duplicate@example.com",
      password: "secret123",
    }),
  });
  assert.equal(duplicate.status, 400);

  const missing = await fetch(`${baseUrl}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Incomplete", email: "new@example.com" }),
  });
  assert.equal(missing.status, 400);
});

for (const [label, credentials] of [
  ["operator email", { email: { $ne: null }, password: "correct-password" }],
  ["array email", { email: ["user@example.com"], password: "correct-password" }],
  ["object password", { email: "user@example.com", password: { $ne: null } }],
  ["array password", { email: "user@example.com", password: ["correct-password"] }],
]) {
  test(`login rejects ${label} before querying persistence`, async (t) => {
    const account = new User({
      ...authUser(),
      password: await bcrypt.hash("correct-password", 4),
    });
    // Return a matching account even for a selector. Input validation belongs
    // to the real route; neither the repository nor password check hides it.
    const lookup = t.mock.method(User, "findOne", async () => account);
    const baseUrl = await startApp(t);
    const response = await fetch(`${baseUrl}/api/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const body = await response.json();

    assert.equal(lookup.mock.callCount(), 0, "invalid credentials reached User.findOne");
    assert.equal(response.status, 400);
    assert.equal(body.token, undefined);
  });
}

test("login brute-force threshold returns 429 after the configured limit", async (t) => {
  const originalFindOne = User.findOne;
  User.findOne = async () => null;
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  let response;
  for (let attempt = 1; attempt <= 21; attempt += 1) {
    response = await fetch(`${baseUrl}/api/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "attacker@example.com", password: `bad-${attempt}` }),
    });
    if (attempt <= 20) assert.equal(response.status, 401, `attempt ${attempt}`);
  }

  assert.equal(response.status, 429);
  assert.match((await response.json()).message, /too many requests/i);
});
