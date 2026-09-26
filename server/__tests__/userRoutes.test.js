import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Order from "../models/Order.js";
import {
  loginUser,
  registerUser,
  updateUserProfile,
  getUserOrders,
  getUsers,
  deleteUser,
} from "../routes/userRoutes.js";

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

test("registerUser creates a valid user and loginUser rejects bad credentials", async () => {
  const createdUser = {
    _id: "u3",
    name: "New User",
    email: "new@example.com",
    isAdmin: false,
    token: "jwt-token",
    createdAt: new Date().toISOString(),
  };

  User.findOne = async ({ email }) => (email === "new@example.com" ? null : null);
  User.create = async ({ name, email, password }) => ({
    ...createdUser,
    name,
    email,
    password,
  });

  const registerReq = mockReqRes({ name: "New User", email: "new@example.com", password: "secret123" });
  await registerUser(registerReq.req, registerReq.res, registerReq.next);
  assert.equal(registerReq.res.statusCode, 201);
  assert.ok(registerReq.res.payload?.token);

  const badLogin = mockReqRes({ email: "missing@example.com", password: "wrong" });
  User.findOne = async () => null;
  await loginUser(badLogin.req, badLogin.res, badLogin.next);
  assert.equal(badLogin.res.statusCode, 401);
});

test("updateUserProfile, getUserOrders, getUsers, and deleteUser cover admin and ownership guardrails", async () => {
  const user = {
    _id: "u1",
    name: "Old Name",
    email: "old@example.com",
    isAdmin: false,
    save: async function () {
      return this;
    },
  };

  User.findById = async (id) => (id === "u1" ? user : null);
  Order.find = () => ({
    sort: async () => [{ _id: "o1", user: "u1" }],
  });
  User.find = () => ({
    select: () => ({
      sort: async () => [{ _id: "u1", email: "old@example.com" }],
    }),
  });
  User.findByIdAndDelete = async (id) => (id === "u2" ? { _id: "u2" } : null);

  const updateRes = {
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
  await updateUserProfile(
    { params: { id: "u1" }, body: { name: "Fresh Name" }, user: { _id: "u1", isAdmin: false } },
    updateRes,
    null,
  );
  assert.equal(updateRes.payload.name, "Fresh Name");

  const ordersRes = {
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await getUserOrders({ params: { id: "u1" }, user: { _id: "u1", isAdmin: false } }, ordersRes, null);
  assert.equal(ordersRes.payload.length, 1);

  const usersRes = {
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await getUsers({}, usersRes, null);
  assert.equal(usersRes.payload.length, 1);

  const deleteRes = {
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await deleteUser({ params: { id: "u2" }, user: { _id: "u9", isAdmin: true } }, deleteRes, null);
  assert.equal(deleteRes.payload._id, "u2");
});
