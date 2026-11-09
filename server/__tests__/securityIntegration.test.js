import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { createApp } from "../app.js";
import User from "../models/User.js";

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "security-integration-test-secret";

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439012";
const ADMIN_ID = "507f1f77bcf86cd799439013";

async function startApp(t, options) {
  const app = createApp(options);
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
  const response = await fetch(`${baseUrl}/api/paypal/client-id`, { headers: { Origin: process.env.CORS_ORIGIN } });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-xss-protection"), "0");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://shop.example.test");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(response.headers.get("vary"), /Origin/i);

  for (const [origin, allowed] of [["https://shop.example.test", "https://shop.example.test"], ["https://other.example.test", null]]) {
    const preflight = await fetch(`${baseUrl}/api/paypal/client-id`, {
      method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), allowed);
  }
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

test("production refuses missing, wildcard or invalid CORS origins", (t) => {
  const previous = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGIN: process.env.CORS_ORIGIN };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.NODE_ENV = "production";
  for (const origin of [undefined, "*", "http://shop.example.test", "https://*.example.test", "https://shop.example.test/api"]) {
    if (origin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = origin;
    assert.throws(() => createApp(), /CORS_ORIGIN must be an explicit HTTPS origin/);
  }
  process.env.CORS_ORIGIN = "https://shop.example.test";
  assert.doesNotThrow(() => createApp());
});

test("storefront documents carry a fresh CSP nonce, API misses stay JSON and report-only is explicit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "techlines-storefront-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "index.html"), "<html><head></head><body>Storefront</body></html>");
  const base = await startApp(t, { storefrontDirectory: directory, cspMode: "enforce" });

  const nonces = new Set();
  for (const path of ["/", "/checkout", "/index.html"]) {
    const result = await fetch(base + path);
    const csp = result.headers.get("content-security-policy");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /frame-src [^;]*https:\/\/cdn\.foxpost\.hu/);
    assert.doesNotMatch(csp, /script-src [^;]*unsafe-inline/);
    const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    nonces.add(nonce);
    assert.ok((await result.text()).includes(`name="csp-nonce" nonce="${nonce}"`));
  }
  assert.equal(nonces.size, 3);

  const apiMiss = await fetch(base + "/api/missing");
  assert.equal(apiMiss.status, 404);
  assert.deepEqual(await apiMiss.json(), { message: "Not Found" });
  const assetMiss = await fetch(base + "/static/js/missing.js");
  assert.equal(assetMiss.status, 404);

  const reportOnly = await startApp(t, { storefrontDirectory: directory, cspMode: "report-only" });
  const report = await fetch(reportOnly);
  assert.equal(report.headers.get("content-security-policy"), null);
  assert.ok(report.headers.has("content-security-policy-report-only"));
});

test("global JSON parser returns safe 400 and 413 responses before the route runs", async (t) => {
  const find = t.mock.method(User, "findOne", () => assert.fail("Parser error reached the route"));
  const base = await startApp(t);
  for (const [body, status, message] of [
    ['{"private":secret}', 400, "Érvénytelen JSON kérés."],
    [JSON.stringify({ private: "secret".repeat(20000) }), 413, "A kérés meghaladja a megengedett méretet."],
  ]) {
    const response = await fetch(base + "/api/users/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { message });
  }
  assert.equal(find.mock.callCount(), 0);
});

test("the exact Bearer scheme is case-insensitive and rejects suffixes or extra credentials", async (t) => {
  const find = t.mock.method(User, "findById", () => ({ select: async () => authUser(ADMIN_ID, { isAdmin: true }) }));
  t.mock.method(User, "find", () => ({ select: () => ({ sort: async () => [] }) }));
  const base = await startApp(t);
  const token = tokenFor(ADMIN_ID);
  for (const authorization of [`BearerForged ${token}`, `Bearer ${token} extra`, `Bearer ${token}, Bearer ${token}`]) {
    const response = await fetch(base + "/api/users", { headers: { authorization } });
    assert.equal(response.status, 401);
  }
  assert.equal(find.mock.callCount(), 0);
  const response = await fetch(base + "/api/users", { headers: { authorization: `bEaReR  ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(find.mock.callCount(), 1);
});

test("register and profile reject invalid shapes before lookup or persistence", async (t) => {
  const lookup = t.mock.method(User, "findOne", () => assert.fail("Invalid email reached User.findOne"));
  const create = t.mock.method(User, "create", () => assert.fail("Invalid registration reached User.create"));
  const findById = t.mock.method(User, "findById", () => ({ select: async () => authUser(USER_ID) }));
  const base = await startApp(t);
  const account = { name: "Test user", email: "test@example.com", password: "test-password" };
  const invalid = [
    { email: { $ne: null } }, { email: [] }, { email: "invalid" }, { name: "   " },
    { name: {} }, { password: [] }, { password: "      " }, { password: "" },
  ];
  for (const fields of invalid) {
    const registration = await fetch(base + "/api/users/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...account, ...fields }),
    });
    assert.equal(registration.status, 400);
    const profile = await fetch(base + "/api/users/profile/" + USER_ID, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(USER_ID)}` },
      body: JSON.stringify(fields),
    });
    assert.equal(profile.status, 400);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(findById.mock.callCount(), invalid.length, "only the auth lookup should run");
});

test("a concurrent duplicate registration uses the same safe error as a known email", async (t) => {
  const duplicateError = Object.assign(new Error("E11000 db.users email private@example.com"), { code: 11000 });
  const user = authUser(USER_ID);
  let known = false;
  t.mock.method(User, "findOne", async () => known ? user : null);
  let attempted = false;
  const create = t.mock.method(User, "create", async () => {
    if (attempted) throw duplicateError;
    attempted = true;
    return user;
  });
  const base = await startApp(t);
  const register = () => fetch(base + "/api/users/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: user.name, email: user.email, password: "test-password" }),
  });
  const results = await Promise.all([register(), register()]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [201, 400]);
  assert.equal(create.mock.callCount(), 2);
  known = true;
  const duplicate = await register();
  assert.equal(duplicate.status, 400);
  const raceBody = await results.find(({ status }) => status === 400).json();
  assert.deepEqual(raceBody, await duplicate.json());
  assert.doesNotMatch(JSON.stringify(raceBody), /E11000|db\.users|private@example/);
});

test("profile updates can omit the password and unexpected database errors stay private", async (t) => {
  const hash = await bcrypt.hash("existing-password", 4);
  const user = User.hydrate({ _id: USER_ID, name: "Old name", email: "old@example.com", password: hash });
  t.mock.method(User, "findById", () => ({ select: async () => authUser(USER_ID), then: (resolve) => resolve(user) }));
  const write = t.mock.method(User.collection, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(User, "findOne", async () => { throw new Error("private database connection data"); });
  const base = await startApp(t);
  const response = await fetch(base + "/api/users/profile/" + USER_ID, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(USER_ID)}` },
    body: JSON.stringify({ name: " New name ", isAdmin: true }),
  });
  assert.equal(response.status, 200);
  const profile = await response.json();
  assert.equal(profile.name, "New name");
  assert.equal(profile.email, "old@example.com");
  assert.equal(profile.isAdmin, false);
  assert.equal(user.password, hash);
  assert.equal(write.mock.calls[0].arguments[1].$set.password, undefined);

  const failure = await fetch(base + "/api/users/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: "test-password" }),
  });
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { message: "Server Error" });
});
