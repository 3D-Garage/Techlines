import express from "express";
import asyncHandler from "express-async-handler";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import CustomOrder from "../models/CustomOrder.js";
import protectRoute, { admin } from "../middleware/autMiddleware.js";
import rateLimit from "../middleware/rateLimit.js";
import { createCustomOrderUpload, removeCustomOrderFile } from "../middleware/customOrderUpload.js";
import { CUSTOM_ORDER_STATUSES, validateCustomOrderInput, validateCustomOrderUpdate } from "../services/customOrderValidation.js";
import { notifyCustomOrderAdmin } from "../services/customOrderNotification.js";
import { getCustomOrderConfig } from "../config/customOrders.js";
import { releaseCustomOrderStorage, storedModelFilename } from "../services/customOrderStorage.js";

const supportedExtensions = [".stl", ".obj", ".step", ".stp"];

const requestError = (status, message) => Object.assign(new Error(message), { status });

// Whitelisting keeps private filesystem names and future internal fields out of API responses.
const adminOrder = (order) => ({
  _id: order._id,
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  customerPhone: order.customerPhone,
  description: order.description,
  material: order.material,
  dimensions: order.dimensions,
  quantity: order.quantity,
  status: order.status,
  adminNotes: order.adminNotes,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  notification: order.notification && {
    status: order.notification.status,
    attemptedAt: order.notification.attemptedAt,
    sentAt: order.notification.sentAt,
  },
  modelFile: order.modelFile && {
    originalName: order.modelFile.originalName,
    size: order.modelFile.size,
    mimeType: order.modelFile.mimeType,
    extension: order.modelFile.extension,
  },
});

const positiveInteger = (value, fallback, maximum) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw requestError(400, "Érvénytelen lapozási paraméter.");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw requestError(400, "Érvénytelen lapozási paraméter.");
  }
  return number;
};

export function createCustomOrderRouter({
  OrderModel = CustomOrder,
  notifyAdmin = notifyCustomOrderAdmin,
  uploadMiddleware = createCustomOrderUpload(),
  limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
} = {}) {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    const { maxFileSizeBytes } = getCustomOrderConfig();
    res.json({ maxFileSizeBytes, supportedExtensions });
  });

  router.post("/", limiter, express.json({ limit: "100kb" }), uploadMiddleware, asyncHandler(async (req, res) => {
    let order;
    try {
      const data = validateCustomOrderInput(req.body, Boolean(req.file));
      const modelFile = req.file ? {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype || "application/octet-stream",
        extension: req.file.extension || path.extname(req.file.filename).toLowerCase(),
        expiresAt: req.file.expiresAt,
      } : undefined;
      order = await OrderModel.create({
        ...data,
        modelFile,
        status: "new",
        adminNotes: "",
        notification: { status: "pending" },
      });
    } catch (error) {
      // An upload belongs to a request only after the database has accepted it.
      await removeCustomOrderFile(req.file).catch(() => {
        console.error("Custom order upload cleanup failed.");
      });
      throw error;
    }
    // The persisted file now counts by its actual size, rather than its reserved
    // maximum. A failed release stays reserved and cannot overbook storage.
    await releaseCustomOrderStorage(req.file).catch(() => console.error("Custom order quota release failed."));

    const notification = { status: "pending", attemptedAt: new Date() };
    try {
      await notifyAdmin(order);
      notification.status = "sent";
      notification.sentAt = new Date();
    } catch (_error) {
      notification.status = "failed";
      console.error(`Custom order admin notification failed for order ${order._id}.`);
    }
    try {
      await OrderModel.updateOne({ _id: order._id }, { $set: { notification } });
    } catch (_error) {
      // A saved request must still succeed if recording notification delivery fails.
      console.error(`Custom order notification state update failed for order ${order._id}.`);
    }

    res.status(201).json({ _id: order._id, status: order.status, createdAt: order.createdAt });
  }));

  router.use(protectRoute, admin);
  router.use(express.json({ limit: "100kb" }));
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/", asyncHandler(async (req, res) => {
    const page = positiveInteger(req.query.page, 1, 1000000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const filter = {};
    if (req.query.status !== undefined) {
      if (typeof req.query.status !== "string" || !CUSTOM_ORDER_STATUSES.includes(req.query.status)) {
        throw requestError(400, "Érvénytelen megrendelési állapot.");
      }
      filter.status = req.query.status;
    }
    const [orders, total] = await Promise.all([
      OrderModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      OrderModel.countDocuments(filter),
    ]);
    res.json({ orders: orders.map(adminOrder), total, page, pages: Math.ceil(total / limit) });
  }));

  const findOrder = async (id) => {
    if (!/^[0-9a-f]{24}$/i.test(id)) throw requestError(400, "Érvénytelen megrendelésazonosító.");
    const order = await OrderModel.findById(id);
    if (!order) throw requestError(404, "A megrendelés nem található.");
    return order;
  };

  router.get("/:id/file", asyncHandler(async (req, res, next) => {
    const order = await findOrder(req.params.id);
    const file = order.modelFile;
    if (!file || !storedModelFilename.test(file.filename)) {
      throw requestError(404, "A modellfájl nem található.");
    }
    const { uploadDir, retentionMs } = getCustomOrderConfig();
    const filename = path.resolve(uploadDir, file.filename);
    const expiresAt = file.expiresAt ? new Date(file.expiresAt).getTime() : new Date(order.createdAt).getTime() + retentionMs;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await removeCustomOrderFile({ path: filename });
      throw requestError(404, "A modellfájl nem található.");
    }
    try {
      const stats = await lstat(filename);
      const [resolvedDirectory, resolvedFile] = await Promise.all([realpath(uploadDir), realpath(filename)]);
      const relativePath = path.relative(resolvedDirectory, resolvedFile);
      if (!stats.isFile() || stats.isSymbolicLink() || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw requestError(404, "A modellfájl nem található.");
      }
    } catch (_error) {
      throw requestError(404, "A modellfájl nem található.");
    }
    const displayName = path.basename(file.originalName || `model${file.extension}`)
      .replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || `model${file.extension}`;
    res.download(filename, displayName, {
      headers: { "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff" },
    }, (error) => {
      if (error && !res.headersSent) next(requestError(404, "A modellfájl nem található."));
    });
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    res.json(adminOrder(await findOrder(req.params.id)));
  }));

  router.patch("/:id/status", asyncHandler(async (req, res) => {
    const update = validateCustomOrderUpdate(req.body);
    const order = await findOrder(req.params.id);
    Object.assign(order, update);
    await order.save();
    res.json(adminOrder(order));
  }));

  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
      const status = error.type === "entity.too.large" ? 413 : 400;
      const message = status === 413 ? "A kérés meghaladja a megengedett méretet." : "Érvénytelen JSON kérés.";
      return res.status(status).json({ message });
    }
    const explicitStatus = Number(error.status || error.statusCode);
    const responseStatus = res.statusCode >= 400 && res.statusCode < 500 ? res.statusCode : 500;
    const controlledError = (explicitStatus >= 400 && explicitStatus < 500) || [503, 507].includes(explicitStatus);
    const status = controlledError ? explicitStatus : responseStatus;
    const fallback = status === 401 ? "Bejelentkezés szükséges."
      : status === 403 ? "Adminisztrátori jogosultság szükséges."
        : "A kérés feldolgozása sikertelen. Kérjük, próbálja újra később.";
    const message = controlledError ? error.message : fallback;
    const body = { message };
    if ([400, 413, 415].includes(status) && error.errors && typeof error.errors === "object") body.errors = error.errors;
    res.status(status).json(body);
  });

  return router;
}

export default createCustomOrderRouter();
