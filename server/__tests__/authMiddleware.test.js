import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import protectRoute from "../middleware/autMiddleware.js";
import User from "../models/User.js";

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "testsecret";

function createMockReqRes(headers = {}) {
  const req = { headers };
  let statusCodeSet;
  const res = {
    status(code) {
      statusCodeSet = code;
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = (err) => {
    res.nextErr = err;
  };
  return { req, res, next };
}

test("protectRoute attaches req.user for valid token", async () => {
  const user = { _id: "u1", name: "Alice", email: "a@example.com" };
  // stub DB call: simulate Mongoose query with select()
  User.findById = () => ({ select: async () => user });
  const token = jwt.sign({ id: user._id }, process.env.TOKEN_SECRET, { expiresIn: "1h" });
  const { req, res, next } = createMockReqRes({ authorization: `Bearer ${token}` });
  await protectRoute(req, res, next);
  assert.equal(typeof res.nextErr, "undefined");
  assert.deepEqual(req.user, user);
});

test("protectRoute rejects missing/invalid token", async () => {
  const { req, res, next } = createMockReqRes({});
  await protectRoute(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.ok(res.nextErr instanceof Error);
});
