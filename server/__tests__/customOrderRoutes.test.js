import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, readdir, rm, readFile, utimes } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import os from "node:os";
import CustomOrder from "../models/CustomOrder.js";
import User from "../models/User.js";
import { createCustomOrderRouter } from "../routes/customOrderRoutes.js";
import { createCustomOrderUpload } from "../middleware/customOrderUpload.js";
import rateLimit from "../middleware/rateLimit.js";
import { cleanupCustomOrderFiles } from "../services/customOrderStorage.js";
import { getCustomOrderConfig } from "../config/customOrders.js";

process.env.TOKEN_SECRET = "custom-order-http-test-secret";
const contact = {
  customerName: "Teszt Elek",
  customerEmail: "teszt@example.com",
  customerPhone: "+36 30 123 4567",
};
const textOrder = { ...contact, description: "Egy fogantyút szeretnék nyomtatni.", quantity: 2 };
const stl = `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle
`;
const obj = "# triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const step = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('test'),'2;1');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n";
const adminHeaders = () => ({ authorization: `Bearer ${jwt.sign({ id: "admin" }, process.env.TOKEN_SECRET)}` });
const customerHeaders = () => ({ authorization: `Bearer ${jwt.sign({ id: "customer" }, process.env.TOKEN_SECRET)}` });

function memoryModel() {
  let nextId = 1;
  const records = new Map();
  class Order {
    constructor(data) {
      Object.assign(this, data, {
        _id: (nextId++).toString(16).padStart(24, "0"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    async save() {
      this.updatedAt = new Date();
      records.set(this._id, this);
      return this;
    }
    static async create(data) {
      if (Order.failCreate) throw new Error("Database connection secret should not escape");
      return new Order(data).save();
    }
    static async updateOne({ _id }, { $set }) {
      if (Order.failNotificationUpdate) throw new Error("Database connection secret should not escape");
      Object.assign(records.get(_id), $set);
    }
    static async findById(id) { return records.get(id) || null; }
    static async countDocuments(filter = {}) {
      return [...records.values()].filter((order) => !filter.status || order.status === filter.status).length;
    }
    static find(filter = {}) {
      let offset = 0;
      return {
        sort() { return this; },
        skip(value) { offset = value; return this; },
        async limit(value) {
          return [...records.values()].filter((order) => !filter.status || order.status === filter.status)
            .sort((a, b) => b._id.localeCompare(a._id)).slice(offset, offset + value);
        },
      };
    }
  }
  return { Order, records };
}

async function harness(t, { notifyAdmin, maxFileSizeBytes = 4096, limiter, ...storageOverrides } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "techlines-custom-orders-"));
  const oldUploadDir = process.env.CUSTOM_ORDER_UPLOAD_DIR;
  process.env.CUSTOM_ORDER_UPLOAD_DIR = directory;
  t.mock.method(User, "findById", (id) => ({
    select: async () => ["admin", "customer"].includes(id) ? { _id: id, isAdmin: id === "admin" } : null,
  }));
  const { Order, records } = memoryModel();
  const notifications = [];
  const app = express();
  app.use("/api/custom-orders", createCustomOrderRouter({
    OrderModel: Order,
    notifyAdmin: notifyAdmin || (async (order) => { notifications.push(order._id); }),
    uploadMiddleware: createCustomOrderUpload({ uploadDir: directory, maxFileSizeBytes, ...storageOverrides }),
    limiter: limiter || ((_req, _res, next) => next()),
  }));
  // Production mounts this router before the global parser so rejected JSON is rate-limited.
  app.use(express.json({ limit: "100kb" }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (oldUploadDir === undefined) delete process.env.CUSTOM_ORDER_UPLOAD_DIR;
    else process.env.CUSTOM_ORDER_UPLOAD_DIR = oldUploadDir;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("techlines-custom-orders-"));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/custom-orders`;
  const request = (suffix = "", options = {}) => fetch(`${base}${suffix}`, options);
  const post = (body = textOrder) => request("", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const upload = (filename = "model.stl", content = stl, fields = contact, mime = "application/octet-stream") => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    form.append("modelFile", new Blob([content], { type: mime }), filename);
    return request("", { method: "POST", body: form });
  };
  return { request, post, upload, Order, records, directory, notifications, base };
}

function setRetention(t, days) {
  const previous = process.env.CUSTOM_ORDER_RETENTION_DAYS;
  process.env.CUSTOM_ORDER_RETENTION_DAYS = String(days);
  t.after(() => {
    if (previous === undefined) delete process.env.CUSTOM_ORDER_RETENTION_DAYS;
    else process.env.CUSTOM_ORDER_RETENTION_DAYS = previous;
  });
}

test("custom order schema requires contact, a model or description, and supported status/quantity", () => {
  assert.equal(new CustomOrder(textOrder).validateSync(), undefined);
  assert.ok(new CustomOrder(contact).validateSync()?.errors.description);
  assert.ok(new CustomOrder({ ...textOrder, customerName: "" }).validateSync()?.errors.customerName);
  assert.ok(new CustomOrder({ ...textOrder, status: "paid" }).validateSync()?.errors.status);
  assert.ok(new CustomOrder({ ...textOrder, quantity: 1.5 }).validateSync()?.errors.quantity);
  assert.ok(new CustomOrder({ ...textOrder, quantity: 10001 }).validateSync()?.errors.quantity);
});

test("text-only submission stores normalized contact, notifies admin, and returns a minimal receipt", async (t) => {
  const h = await harness(t);
  const response = await h.post({ ...textOrder, customerName: "  Teszt Elek  ", customerEmail: "TEST@example.com" });
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ["_id", "createdAt", "status"]);
  assert.equal(receipt.status, "new");
  const saved = h.records.get(receipt._id);
  assert.equal(saved.customerName, "Teszt Elek");
  assert.equal(saved.customerEmail, "test@example.com");
  assert.equal(saved.notification.status, "sent");
  assert.ok(saved.notification.sentAt);
  assert.deepEqual(h.notifications, [receipt._id]);
  assert.equal(saved.modelFile, undefined);
});

test("public contact and print validation rejects invalid requests without persistence or mail", async (t) => {
  const h = await harness(t);
  const invalid = [
    contact,
    { ...textOrder, customerName: "" },
    { ...textOrder, customerEmail: "not-an-email" },
    { ...textOrder, customerPhone: "123" },
    { ...textOrder, customerPhone: { $ne: null } },
    { ...textOrder, quantity: 0 },
    { ...textOrder, quantity: 1.25 },
    { ...textOrder, quantity: 10001 },
    { ...textOrder, description: "a".repeat(10001) },
  ];
  for (const body of invalid) {
    const response = await h.post(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 180));
    assert.ok((await response.json()).message);
  }
  assert.equal(h.records.size, 0);
  assert.equal(h.notifications.length, 0);
});

test("public submissions cannot set admin state or inject database operators", async (t) => {
  const h = await harness(t);
  const response = await h.post({
    ...textOrder, status: "completed", adminNotes: "Forged note", notification: { status: "sent" },
    $set: { customerEmail: "attacker@example.com" },
  });
  // Either rejecting unexpected fields or ignoring them is safe; neither may alter protected state.
  assert.ok([201, 400].includes(response.status));
  if (response.status === 201) {
    const saved = h.records.get((await response.json())._id);
    assert.equal(saved.status, "new");
    assert.equal(saved.adminNotes, "");
    assert.equal(saved.customerEmail, contact.customerEmail);
    assert.equal(saved.$set, undefined);
  }
});

test("all supported model extensions accept file-only requests with private generated filenames", async (t) => {
  const h = await harness(t);
  for (const [extension, content] of [["stl", stl], ["obj", obj], ["step", step], ["stp", step]]) {
    const response = await h.upload(`customer-model.${extension}`, content);
    assert.equal(response.status, 201, `${extension}: ${await response.clone().text()}`);
    const saved = h.records.get((await response.json())._id);
    assert.match(saved.modelFile.filename, new RegExp(`^[0-9a-f-]{36}\\.${extension}$`));
    assert.equal(saved.modelFile.originalName, `customer-model.${extension}`);
    assert.equal(saved.modelFile.extension, `.${extension}`);
    assert.equal(saved.modelFile.path, undefined);
    assert.equal(await readFile(path.join(h.directory, saved.modelFile.filename), "utf8"), content);
  }
  assert.equal((await readdir(h.directory)).length, 4);
});

test("multipart submission accepts all seven contact/project fields together with a model", async (t) => {
  const h = await harness(t);
  const response = await h.upload("alkatrész.stl", stl, {
    ...textOrder, material: "PETG", dimensions: "120 × 40 × 15 mm",
  });
  assert.equal(response.status, 201, await response.clone().text());
  const order = h.records.get((await response.json())._id);
  assert.equal(order.material, "PETG");
  assert.equal(order.dimensions, "120 × 40 × 15 mm");
  assert.equal(order.description, textOrder.description);
  assert.equal(order.quantity, 2);
  assert.equal(order.modelFile.originalName, "alkatrész.stl");
});

test("duplicate fields, extra files, and malformed multipart bodies are rejected and cleaned up", async (t) => {
  const h = await harness(t);
  const repeated = new FormData();
  for (const [key, value] of Object.entries(contact)) repeated.append(key, value);
  repeated.append("customerName", "Második név");
  repeated.append("modelFile", new Blob([stl]), "model.stl");
  assert.equal((await h.request("", { method: "POST", body: repeated })).status, 400);
  assert.deepEqual(await readdir(h.directory), []);

  const extraFiles = new FormData();
  for (const [key, value] of Object.entries(contact)) extraFiles.append(key, value);
  extraFiles.append("modelFile", new Blob([stl]), "first.stl");
  extraFiles.append("modelFile", new Blob([stl]), "second.stl");
  assert.equal((await h.request("", { method: "POST", body: extraFiles })).status, 400);
  assert.deepEqual(await readdir(h.directory), []);

  const malformed = await h.request("", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=unfinished-boundary" },
    body: `--unfinished-boundary\r\nContent-Disposition: form-data; name="modelFile"; filename="model.stl"\r\nContent-Type: model/stl\r\n\r\n${stl}`,
  });
  assert.equal(malformed.status, 400);
  assert.ok((await malformed.json()).errors.modelFile);
  assert.deepEqual(await readdir(h.directory), []);
  assert.equal(h.records.size, 0);
  assert.equal(h.notifications.length, 0);
});

test("binary STL is accepted by its structure and truncated binary data is rejected", async (t) => {
  const h = await harness(t);
  const binary = Buffer.alloc(134);
  binary.write("Test binary STL");
  binary.writeUInt32LE(1, 80);
  assert.equal((await h.upload("model.stl", binary, contact, "image/png")).status, 201);
  const malformed = await h.upload("broken.stl", binary.subarray(0, 133));
  assert.equal(malformed.status, 400);
  assert.equal(h.records.size, 1);
  assert.equal((await readdir(h.directory)).length, 1);
});

test("upload rejects unsupported extensions and executable/script content hidden as models", async (t) => {
  const h = await harness(t);
  for (const [filename, content] of [
    ["model.exe", stl], ["model.stl.js", stl], ["model.svg", "<svg></svg>"],
    ["model.obj", "<script>alert('xss')</script>"], ["model.stl", "MZ executable payload"],
    ["model.step", "#!/bin/sh\necho dangerous"],
  ]) {
    const response = await h.upload(filename, content);
    assert.ok([400, 415].includes(response.status), `${filename}: ${response.status}`);
  }
  assert.equal(h.records.size, 0);
  assert.deepEqual(await readdir(h.directory), []);
});

test("upload size limit is enforced and unsuccessful request uploads are cleaned up", async (t) => {
  const h = await harness(t, { maxFileSizeBytes: 256 });
  const tooLarge = await h.upload("model.obj", `${obj}${"# padding\n".repeat(40)}`);
  assert.equal(tooLarge.status, 413);
  const invalidContact = await h.upload("model.stl", stl, { ...contact, customerEmail: "invalid" });
  assert.equal(invalidContact.status, 400);
  h.Order.failCreate = true;
  const databaseFailure = await h.upload("model.stl", stl);
  assert.equal(databaseFailure.status, 500);
  assert.doesNotMatch(await databaseFailure.text(), /Database connection secret|stack|Mongo/);
  assert.equal(h.records.size, 0);
  assert.deepEqual(await readdir(h.directory), []);
});

test("a failed email preserves both the accepted request and uploaded file", async (t) => {
  const h = await harness(t, { notifyAdmin: async () => { throw new Error("SMTP password secret"); } });
  const response = await h.upload();
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ["_id", "createdAt", "status"]);
  const saved = h.records.get(receipt._id);
  assert.equal(saved.notification.status, "failed");
  assert.ok(saved.notification.attemptedAt);
  assert.equal(saved.notification.sentAt, undefined);
  assert.equal(await readFile(path.join(h.directory, saved.modelFile.filename), "utf8"), stl);
});

test("notification bookkeeping failure does not convert a stored request into a submission failure", async (t) => {
  const h = await harness(t);
  h.Order.failNotificationUpdate = true;
  const response = await h.post();
  assert.equal(response.status, 201);
  assert.equal(h.records.size, 1);
  assert.equal(h.notifications.length, 1);
});

test("all admin list/detail/download/update endpoints enforce login and admin permission", async (t) => {
  const h = await harness(t);
  const id = (await (await h.upload()).json())._id;
  for (const headers of [{}, { authorization: "Bearer invalid" }, customerHeaders()]) {
    const expected = headers.authorization?.includes("invalid") || !headers.authorization ? 401 : 403;
    for (const [suffix, method] of [["", "GET"], [`/${id}`, "GET"], [`/${id}/file`, "GET"], [`/${id}/status`, "PATCH"]]) {
      const response = await h.request(suffix, { method, headers });
      assert.equal(response.status, expected, `${method} ${suffix}`);
      assert.doesNotMatch(await response.text(), /customerEmail|filename|stack|JsonWebTokenError/);
    }
  }
});

test("admin list is paginated and detail omits private storage metadata", async (t) => {
  const h = await harness(t);
  const first = (await (await h.upload()).json())._id;
  await h.post();
  await h.post();
  const response = await h.request("?page=2&limit=2", { headers: adminHeaders() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const list = await response.json();
  assert.equal(list.total, 3);
  assert.equal(list.page, 2);
  assert.equal(list.pages, 2);
  assert.deepEqual(list.orders.map((order) => order._id), [first]);
  const detailResponse = await h.request(`/${first}`, { headers: adminHeaders() });
  const detail = await detailResponse.json();
  assert.equal(detail.customerName, contact.customerName);
  assert.equal(detail.modelFile.originalName, "model.stl");
  assert.equal(detail.modelFile.filename, undefined);
  assert.equal(detail.modelFile.path, undefined);
  h.records.get(first).status = "review";
  const filtered = await (await h.request("?status=review", { headers: adminHeaders() })).json();
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.orders.map((order) => order._id), [first]);
  for (const query of ["?page=-1", "?limit=101", "?page[$gt]=1", "?page=1.5", "?status=paid", "?status[$ne]=new"]) {
    assert.equal((await h.request(query, { headers: adminHeaders() })).status, 400);
  }
  assert.equal((await h.request("/invalid-id", { headers: adminHeaders() })).status, 400);
  assert.equal((await h.request("/ffffffffffffffffffffffff", { headers: adminHeaders() })).status, 404);
});

test("admin can update each status and internal notes, while invalid/unsafe updates are rejected", async (t) => {
  const h = await harness(t);
  const id = (await (await h.post()).json())._id;
  const patch = (body) => h.request(`/${id}/status`, {
    method: "PATCH", headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  for (const status of ["review", "quoted", "accepted", "printing", "completed", "rejected", "new"]) {
    const response = await patch({ status, adminNotes: `Belső megjegyzés: ${status}` });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, status);
    assert.equal(result.adminNotes, `Belső megjegyzés: ${status}`);
  }
  const notesOnly = await patch({ adminNotes: "Új belső megjegyzés" });
  assert.equal(notesOnly.status, 200);
  assert.equal((await notesOnly.json()).status, "new");
  assert.equal((await patch({ adminNotes: "" })).status, 200);
  for (const body of [{ status: "paid" }, { status: { $ne: null } }, {}, { adminNotes: "x".repeat(10001) }]) {
    assert.equal((await patch(body)).status, 400);
  }
  const protectedUpdate = await patch({ status: "review", customerEmail: "attacker@example.com", modelFile: { filename: "evil" } });
  assert.ok([200, 400].includes(protectedUpdate.status));
  assert.equal(h.records.get(id).customerEmail, contact.customerEmail);
  assert.equal(h.records.get(id).modelFile, undefined);
});

test("admin attachment download is an opaque attachment and rejects corrupted traversal metadata", async (t) => {
  const h = await harness(t);
  const id = (await (await h.upload()).json())._id;
  const response = await h.request(`/${id}/file`, { headers: adminHeaders() });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), stl);
  h.records.get(id).modelFile.filename = "../../package.json";
  const traversal = await h.request(`/${id}/file`, { headers: adminHeaders() });
  assert.equal(traversal.status, 404);
  assert.doesNotMatch(await traversal.text(), /package.json|Techlines|private-uploads/);
});

test("public submission rate limiting runs before file storage and database writes", async (t) => {
  const h = await harness(t, { limiter: rateLimit({ windowMs: 60000, max: 1 }) });
  assert.equal((await h.post()).status, 201);
  assert.equal((await h.upload()).status, 429);
  assert.equal(h.records.size, 1);
  assert.deepEqual(await readdir(h.directory), []);
  // Admin reads and public metadata are not charged against submission limits.
  assert.equal((await h.request("", { headers: adminHeaders() })).status, 200);
  const config = await h.request("/config");
  assert.equal(config.status, 200);
  const body = await config.json();
  assert.deepEqual(Object.keys(body).sort(), ["fileRetentionDays", "maxFileSizeBytes", "supportedExtensions"]);
  assert.deepEqual(body.supportedExtensions, [".stl", ".obj", ".step", ".stp"]);
  assert.ok(body.maxFileSizeBytes > 0);
  assert.ok(Number.isFinite(body.fileRetentionDays) && body.fileRetentionDays > 0);
  assert.equal(body.fileRetentionDays, getCustomOrderConfig().retentionMs / (24 * 60 * 60 * 1000));
  assert.equal(body.uploadDir, undefined);
});

test("malformed and oversized JSON return controlled errors and count toward the submission rate limit", async (t) => {
  const h = await harness(t, { limiter: rateLimit({ windowMs: 60000, max: 2 }) });
  const malformed = await h.request("", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"sensitive-input":',
  });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.deepEqual(malformedBody, { message: "Érvénytelen JSON kérés." });
  assert.doesNotMatch(JSON.stringify(malformedBody), /sensitive-input|SyntaxError|stack|Unexpected/);

  const oversized = await h.post({ ...textOrder, description: "x".repeat(102401) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { message: "A kérés meghaladja a megengedett méretet." });

  assert.equal((await h.post()).status, 429);
  assert.equal(h.records.size, 0);
  assert.equal(h.notifications.length, 0);
  assert.deepEqual(await readdir(h.directory), []);
});

test("admin JSON updates authenticate before parsing and conceal malformed request contents", async (t) => {
  const h = await harness(t);
  const id = (await (await h.post()).json())._id;
  const options = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"sensitive-note":' };
  assert.equal((await h.request(`/${id}/status`, options)).status, 401);
  assert.equal((await h.request(`/${id}/status`, { ...options, headers: { ...options.headers, ...customerHeaders() } })).status, 403);
  const response = await h.request(`/${id}/status`, { ...options, headers: { ...options.headers, ...adminHeaders() } });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Érvénytelen JSON kérés." });
  assert.equal(h.records.get(id).adminNotes, "");
});

test("aggregate storage refuses further files with a controlled response while text orders still work", async (t) => {
  const h = await harness(t, { maxFileSizeBytes: 256, maxStorageBytes: 256 });
  assert.equal((await h.upload()).status, 201);
  const full = await h.upload();
  assert.equal(full.status, 503);
  assert.ok(full.headers.get("retry-after"));
  assert.match((await full.json()).message, /tárhelye megtelt/);
  assert.equal((await readdir(h.directory)).length, 1);
  assert.equal(h.records.size, 1);
  assert.equal((await h.post()).status, 201);
});

test("rejected, malformed and failed database uploads release their entire reservation", async (t) => {
  const h = await harness(t, { maxFileSizeBytes: 256, maxStorageBytes: 256 });
  assert.equal((await h.upload("model.obj", "x".repeat(257))).status, 413);
  assert.equal((await h.upload("model.obj", "not a model")).status, 400);
  assert.equal((await h.upload("model.stl", stl, { ...contact, customerEmail: "bad" })).status, 400);
  assert.equal((await h.request("", {
    method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=broken" },
    body: `--broken\r\nContent-Disposition: form-data; name="modelFile"; filename="model.stl"\r\n\r\n${stl}`,
  })).status, 400);
  h.Order.failCreate = true;
  assert.equal((await h.upload()).status, 500);
  assert.deepEqual(await readdir(h.directory), []);
  h.Order.failCreate = false;
  assert.equal((await h.upload()).status, 201);
});

test("an unfinished upload reserves capacity, and aborting it removes the partial file and frees capacity", async (t) => {
  const h = await harness(t, { maxFileSizeBytes: 256, maxStorageBytes: 256 });
  const pending = httpRequest(h.base, { method: "POST", headers: {
    "Content-Type": "multipart/form-data; boundary=slow-upload",
  } });
  pending.on("error", () => {});
  t.after(() => pending.destroy());
  pending.write(`--slow-upload\r\nContent-Disposition: form-data; name="modelFile"; filename="model.stl"\r\n\r\n${stl}`);
  const waitForFiles = async (count) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await readdir(h.directory)).length === count) return;
      await delay(10);
    }
    assert.fail(`Expected ${count} upload files`);
  };
  await waitForFiles(1);
  assert.equal((await h.upload()).status, 503);
  pending.destroy();
  await waitForFiles(0);
  assert.equal((await h.upload()).status, 201);
  assert.equal(h.records.size, 1);
});

test("expired attachments are disclosed to admins, cleaned up, and cannot be downloaded", async (t) => {
  const h = await harness(t);
  const id = (await (await h.upload()).json())._id;
  const order = h.records.get(id);
  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  order.modelFile.uploadedAt = oldDate;
  await utimes(path.join(h.directory, order.modelFile.filename), oldDate, oldDate);
  const detail = await (await h.request(`/${id}`, { headers: adminHeaders() })).json();
  assert.equal(detail.modelFile.expired, true);
  assert.ok(new Date(detail.modelFile.expiresAt).getTime() < Date.now());
  assert.equal((await h.request(`/${id}/file`, { headers: adminHeaders() })).status, 410);
  await cleanupCustomOrderFiles({ ...getCustomOrderConfig(), uploadDir: h.directory });
  assert.deepEqual(await readdir(h.directory), []);
  assert.equal(h.records.size, 1);
  assert.equal(order.customerEmail, contact.customerEmail);
  // Older records have no uploadedAt field; their creation time is the fallback.
  delete order.modelFile.uploadedAt;
  order.createdAt = oldDate;
  assert.equal((await h.request(`/${id}/file`, { headers: adminHeaders() })).status, 410);
  assert.equal((await (await h.request(`/${id}`, { headers: adminHeaders() })).json()).modelFile.expired, true);
});

test("extending retention cannot restore a deleted attachment in detail, list, update or download responses", async (t) => {
  setRetention(t, 30);
  const h = await harness(t);
  const id = (await (await h.upload()).json())._id;
  const order = h.records.get(id);
  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  order.modelFile.uploadedAt = oldDate;
  await utimes(path.join(h.directory, order.modelFile.filename), oldDate, oldDate);

  const before = await (await h.request(`/${id}`, { headers: adminHeaders() })).json();
  assert.equal(before.modelFile.expired, true);
  assert.equal(before.modelFile.available, false);
  assert.equal(before.modelFile.missing, false);
  assert.equal((await cleanupCustomOrderFiles(getCustomOrderConfig())).removed, 1);
  assert.deepEqual(await readdir(h.directory), []);

  process.env.CUSTOM_ORDER_RETENTION_DAYS = "60";
  const assertMissing = (response) => {
    assert.equal(response.modelFile.expired, false);
    assert.equal(response.modelFile.available, false);
    assert.equal(response.modelFile.missing, true);
    assert.equal(response.modelFile.expiresAt, null);
    assert.equal(response.modelFile.originalName, "model.stl");
    assert.equal(response.modelFile.size, order.modelFile.size);
    assert.equal(response.modelFile.filename, undefined);
    assert.equal(response.customerEmail, contact.customerEmail);
  };
  assertMissing(await (await h.request(`/${id}`, { headers: adminHeaders() })).json());
  const list = await (await h.request("", { headers: adminHeaders() })).json();
  assertMissing(list.orders[0]);
  const updated = await h.request(`/${id}/status`, {
    method: "PATCH", headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ status: "completed", adminNotes: "Keep the request data" }),
  });
  assert.equal(updated.status, 200);
  assertMissing(await updated.json());
  assert.equal(order.status, "completed");
  assert.equal(order.adminNotes, "Keep the request data");

  const download = await h.request(`/${id}/file`, { headers: adminHeaders() });
  assert.equal(download.status, 410);
  assert.equal((await download.json()).code, "CUSTOM_ORDER_FILE_MISSING");
  // Legacy records and files removed before the availability check also work
  // without requiring a deletion timestamp or a database migration.
  delete order.modelFile.uploadedAt;
  order.createdAt = oldDate;
  assertMissing(await (await h.request(`/${id}`, { headers: adminHeaders() })).json());
  assert.equal(h.records.size, 1);
});

test("extending retention makes a still-present attachment available again", async (t) => {
  setRetention(t, 30);
  const h = await harness(t);
  const id = (await (await h.upload()).json())._id;
  h.records.get(id).modelFile.uploadedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const expired = await h.request(`/${id}/file`, { headers: adminHeaders() });
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).code, "CUSTOM_ORDER_FILE_EXPIRED");

  process.env.CUSTOM_ORDER_RETENTION_DAYS = "60";
  const detail = await (await h.request(`/${id}`, { headers: adminHeaders() })).json();
  assert.equal(detail.modelFile.expired, false);
  assert.equal(detail.modelFile.available, true);
  assert.equal(detail.modelFile.missing, false);
  assert.ok(new Date(detail.modelFile.expiresAt).getTime() > Date.now());
  const download = await h.request(`/${id}/file`, { headers: adminHeaders() });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), stl);
});

test("filesystem access failures return controlled errors instead of claiming the attachment is missing", async (t) => {
  const h = await harness(t);
  const id = (await (await h.upload()).json())._id;
  const filename = path.join(h.directory, h.records.get(id).modelFile.filename);
  const originalLstat = fs.lstat;
  const lstatMock = t.mock.method(fs, "lstat", async (location, ...options) => {
    if (location === filename) throw Object.assign(new Error(`Permission denied: ${filename}`), { code: "EACCES" });
    return originalLstat(location, ...options);
  });
  syncBuiltinESMExports();
  try {
    for (const suffix of ["", `/${id}`, `/${id}/file`]) {
      const response = await h.request(suffix, { headers: adminHeaders() });
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ["message"]);
      assert.doesNotMatch(body.message, /Permission|EACCES|techlines-custom-orders|nem érhető el/);
    }
  } finally {
    lstatMock.mock.restore();
    syncBuiltinESMExports();
  }
  const recovered = await (await h.request(`/${id}`, { headers: adminHeaders() })).json();
  assert.equal(recovered.modelFile.available, true);
  assert.equal(recovered.modelFile.missing, false);
});
