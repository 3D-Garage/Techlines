import nodemailer from "nodemailer";
import validator from "validator";
import { normalizeCustomOrderText } from "./customOrderValidation.js";

function emailAddress(value, label) {
  if (
    typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    /[\u0000-\u0020\u007f-\u009f]/.test(value.trim()) ||
    !validator.isEmail(value.trim(), { allow_display_name: false, allow_utf8_local_part: false })
  ) {
    throw new Error(`Invalid custom order email configuration: ${label}`);
  }
  return value.trim();
}

function adminUrl(appBaseUrl, id) {
  if (!appBaseUrl) return undefined;
  let base;
  try { base = new URL(appBaseUrl); } catch { throw new Error("Invalid APP_BASE_URL"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("Invalid APP_BASE_URL");
  }
  return new URL(`/admin/custom-orders/${encodeURIComponent(id)}`, base).href;
}

const literalText = (value) => normalizeCustomOrderText(String(value ?? ""));

// No HTML or attachments: customer text is only ever used as literal message body text.
export function buildCustomOrderEmail(order, config = {
  from: process.env.SMTP_FROM,
  adminEmail: process.env.CUSTOM_ORDER_ADMIN_EMAIL,
  appBaseUrl: process.env.APP_BASE_URL,
}) {
  const from = emailAddress(config.from, "SMTP_FROM");
  const to = emailAddress(config.adminEmail, "CUSTOM_ORDER_ADMIN_EMAIL");
  const replyTo = emailAddress(order.customerEmail, "customerEmail");
  const id = String(order._id ?? order.id ?? "");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid custom order ID");
  const link = adminUrl(config.appBaseUrl, id);
  const file = order.modelFile;
  const fileSummary = file
    ? `Igen – ${literalText(file.originalName).replace(/[\n\t]/g, " ")} (${Number(file.size) || 0} bájt)`
    : "Nem";
  const text = [
    "Új egyedi 3D nyomtatási megrendelés érkezett.",
    "",
    `Megrendelés azonosítója: ${id}`,
    `Név: ${literalText(order.customerName)}`,
    `Email: ${replyTo}`,
    `Telefonszám: ${literalText(order.customerPhone)}`,
    `Anyag: ${literalText(order.material) || "Nincs megadva"}`,
    `Méretek: ${literalText(order.dimensions) || "Nincs megadva"}`,
    `Mennyiség: ${literalText(order.quantity) || "Nincs megadva"}`,
    `Modellfájl csatolva a megrendeléshez: ${fileSummary}`,
    "",
    "Leírás:",
    literalText(order.description) || "Nincs megadva",
    ...(link ? ["", `Adminisztráció: ${link}`] : []),
  ].join("\n");
  return {
    from, to, replyTo,
    subject: `Új egyedi megrendelés – ${id}`,
    text,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export async function notifyCustomOrderAdmin(order, { env = process.env, createTransport = nodemailer.createTransport } = {}) {
  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT || 587);
  const secureValue = (env.SMTP_SECURE || "false").toLowerCase();
  if (!host || /\s/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid custom order SMTP configuration");
  }
  if (!["true", "false"].includes(secureValue)) throw new Error("Invalid SMTP_SECURE configuration");
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) throw new Error("Both SMTP_USER and SMTP_PASS are required for authentication");
  const message = buildCustomOrderEmail(order, {
    from: env.SMTP_FROM,
    adminEmail: env.CUSTOM_ORDER_ADMIN_EMAIL,
    appBaseUrl: env.APP_BASE_URL || "",
  });
  const transport = createTransport({
    host, port, secure: secureValue === "true",
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    dnsTimeout: 5000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail(message);
    if (
      result.rejected?.length ||
      !result.accepted?.some((address) => String(address).toLowerCase() === message.to.toLowerCase())
    ) {
      throw new Error("Custom order notification was not accepted by the SMTP server");
    }
    return result;
  } finally {
    transport.close?.();
  }
}
