import express from "express";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import User from "../../models/User.js";
import { createCustomOrderRouter } from "../../routes/customOrderRoutes.js";
import { createCustomOrderUpload } from "../../middleware/customOrderUpload.js";

export async function startStorageTestServer(config) {
  process.env.TOKEN_SECRET = "upload-storage-http-test-secret";
  process.env.CUSTOM_ORDER_UPLOAD_DIR = config.uploadDir;
  const records = new Map();
  let nextId = 1;
  const OrderModel = {
    async create(data) {
      const record = { ...data, _id: String(nextId++).padStart(24, "0"), createdAt: new Date() };
      records.set(record._id, record);
      return record;
    },
    async updateOne() {},
    async findById(id) { return records.get(id); },
  };
  const original = User.findById;
  User.findById = (id) => ({ select: async () => id === "admin" ? { _id: id, isAdmin: true } : null });
  const app = express();
  app.use("/api/custom-orders", createCustomOrderRouter({
    OrderModel, uploadMiddleware: createCustomOrderUpload(config), notifyAdmin: async () => {},
    limiter: (_req, _res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    records, base: `http://127.0.0.1:${server.address().port}/api/custom-orders`,
    adminHeaders: { authorization: `Bearer ${jwt.sign({ id: "admin" }, process.env.TOKEN_SECRET)}` },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      User.findById = original;
    },
  };
}

// Subprocesses share only their upload filesystem; model fixtures are isolated.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startStorageTestServer(JSON.parse(process.argv[2]));
  process.send({ base: server.base });
  process.on("message", async (message) => {
    if (message === "close") { await server.close(); process.disconnect(); }
  });
}
