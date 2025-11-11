import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { loginUser, registerUser } from "../routes/userRoutes.js";

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "testsecret";

function mockReqRes(body = {}) {
  const req = { body };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  const next = (err) => {
    res.nextErr = err;
  };
  return { req, res, next };
}

test("loginUser succeeds with correct credentials", async () => {
  const fakeUser = {
    _id: "u1",
    name: "Tester",
    email: "t@example.com",
    isAdmin: false,
    matchPasswords: async (p) => p === "secret123",
    createdAt: new Date().toISOString(),
  };
  User.findOne = async ({ email }) => (email === fakeUser.email ? fakeUser : null);

  const { req, res, next } = mockReqRes({ email: fakeUser.email, password: "secret123" });
  await loginUser(req, res, next);
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload?.token, "should return a token");
  const decoded = jwt.verify(res.payload.token, process.env.TOKEN_SECRET);
  assert.equal(decoded.id, fakeUser._id);
});

test("registerUser rejects duplicate email", async () => {
  const dupe = { _id: "u2", email: "x@example.com" };
  User.findOne = async ({ email }) => (email === dupe.email ? dupe : null);
  const { req, res, next } = mockReqRes({ name: "X", email: "x@example.com", password: "abcdef" });
  await registerUser(req, res, next);
  assert.equal(res.statusCode, 400);
  assert.ok(res.nextErr instanceof Error);
});

