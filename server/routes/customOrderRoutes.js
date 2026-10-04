import express from "express";
import asyncHandler from "express-async-handler";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import CustomOrder from "../models/CustomOrder.js";
import protectRoute, { admin } from "../middleware/autMiddleware.js";
import rateLimit from "../middleware/rateLimit.js";
import { createCustomOrderUpload, releaseCustomOrderFile, removeCustomOrderFile } from "../middleware/customOrderUpload.js";
import { CUSTOM_ORDER_STATUSES, validateCustomOrderInput, validateCustomOrderUpdate } from "../services/customOrderValidation.js";
import { notifyCustomOrderAdmin } from "../services/customOrderNotification.js";
import { getCustomOrderConfig, STORED_MODEL_FILENAME } from "../config/customOrders.js";

const supportedExtensions = [".stl", ".obj", ".step", ".stp"];

const requestError = (status, message) => Object.assign(new Error(message), { status });

// The filesystem is the source of truth for availability, including files
// removed before this check was introduced. Retention changes cannot restore
// a missing attachment or make it appear downloadable again.
const fileState = async (order) => {
  const { uploadDir, retentionMs } = getCustomOrderConfig();
  const uploadedAt = new Date(order.modelFile?.uploadedAt || order.createdAt).getTime();
  const expiresAt = new Date(uploadedAt + retentionMs);
  const expired = expiresAt.getTime() <= Date.now();
  const missing = { expiresAt: null, expired, available: false, missing: true };
  if (!STORED_MODEL_FILENAME.test(order.modelFile?.filename || "")) return missing;
  const filename = path.resolve(uploadDir, order.modelFile.filename);
  try {
    const stats = await lstat(filename);
    const [resolvedDirectory, resolvedFile] = await Promise.all([realpath(uploadDir), realpath(filename)]);
    const relativePath = path.relative(resolvedDirectory, resolvedFile);
    if (!stats.isFile() || stats.isSymbolicLink() || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return missing;
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return missing;
    // Permission and I/O failures do not establish that a file was deleted.
    throw error;
  }
  return { filename, expiresAt, expired, available: !expired, missing: false };
};

// Whitelisting keeps private filesystem names and future internal fields out of API responses.
const adminOrder = async (order) => {
  const attachment = order.modelFile ? await fileState(order) : undefined;
  return {
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
      expiresAt: attachment.expiresAt,
      expired: attachment.expired,
      available: attachment.available,
      missing: attachment.missing,
    },
  };
};

const missingFileError = () => Object.assign(requestError(410, "A modellfájl már nem érhető el."), {
  code: "CUSTOM_ORDER_FILE_MISSING",
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
    const { maxFileSizeBytes, retentionMs } = getCustomOrderConfig();
    res.json({ maxFileSizeBytes, supportedExtensions, fileRetentionDays: retentionMs / (24 * 60 * 60 * 1000) });
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
        uploadedAt: req.file.uploadedAt,
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
    releaseCustomOrderFile(req.file);

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
    res.json({ orders: await Promise.all(orders.map(adminOrder)), total, page, pages: Math.ceil(total / limit) });
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
    if (!file || !STORED_MODEL_FILENAME.test(file.filename)) {
      throw requestError(404, "A modellfájl nem található.");
    }
    const attachment = await fileState(order);
    if (attachment.missing) throw missingFileError();
    if (attachment.expired) {
      throw Object.assign(requestError(410, "A modellfájl megőrzési ideje lejárt, ezért már nem tölthető le."), {
        code: "CUSTOM_ORDER_FILE_EXPIRED",
      });
    }
    const displayName = path.basename(file.originalName || `model${file.extension}`)
      .replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || `model${file.extension}`;
    res.download(attachment.filename, displayName, {
      headers: { "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff" },
    }, (error) => {
      if (error && !res.headersSent) {
        next(error.code === "ENOENT" ? missingFileError() : requestError(404, "A modellfájl nem található."));
      }
    });
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    res.json(await adminOrder(await findOrder(req.params.id)));
  }));

  router.patch("/:id/status", asyncHandler(async (req, res) => {
    const update = validateCustomOrderUpdate(req.body);
    const order = await findOrder(req.params.id);
    Object.assign(order, update);
    await order.save();
    res.json(await adminOrder(order));
  }));

  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
      const status = error.type === "entity.too.large" ? 413 : 400;
      const message = status === 413 ? "A kérés meghaladja a megengedett méretet." : "Érvénytelen JSON kérés.";
      return res.status(status).json({ message });
    }
    const explicitStatus = Number(error.status || error.statusCode);
    if (error.code === "CUSTOM_ORDER_STORAGE_FULL" && explicitStatus === 503) {
      res.setHeader("Retry-After", "3600");
      return res.status(503).json({ message: error.message });
    }
    const responseStatus = res.statusCode >= 400 && res.statusCode < 500 ? res.statusCode : 500;
    const status = explicitStatus >= 400 && explicitStatus < 500 ? explicitStatus : responseStatus;
    const fallback = status === 401 ? "Bejelentkezés szükséges."
      : status === 403 ? "Adminisztrátori jogosultság szükséges."
        : "A kérés feldolgozása sikertelen. Kérjük, próbálja újra később.";
    const message = explicitStatus >= 400 && explicitStatus < 500 ? error.message : fallback;
    const body = { message };
    if (["CUSTOM_ORDER_FILE_MISSING", "CUSTOM_ORDER_FILE_EXPIRED"].includes(error.code)) body.code = error.code;
    if ([400, 413, 415].includes(status) && error.errors && typeof error.errors === "object") body.errors = error.errors;
    res.status(status).json(body);
  });

  return router;
}

export default createCustomOrderRouter();
