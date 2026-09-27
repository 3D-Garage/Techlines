import validator from "validator";

export const CUSTOM_ORDER_STATUSES = Object.freeze([
  "new", "review", "quoted", "accepted", "printing", "completed", "rejected",
]);

const PUBLIC_FIELDS = new Set([
  "customerName", "customerEmail", "customerPhone", "description", "material", "dimensions", "quantity",
]);
const UPDATE_FIELDS = new Set(["status", "adminNotes"]);

// Store literal text. HTML escaping belongs to the rendering context, not the database.
export function normalizeCustomOrderText(value) {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .trim();
}

function validationError(errors) {
  const error = new Error("Kérjük, ellenőrizze a megadott adatokat.");
  error.status = 400;
  error.errors = { ...errors };
  return error;
}

function validateBody(body, allowedFields, errors) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError({ form: "Érvénytelen kérés." });
  }
  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) errors[field] = "Ez a mező nem engedélyezett.";
  }
}

function textField(body, field, maxLength, errors, { required = false, multiline = false } = {}) {
  const rawValue = body[field];
  if (Object.hasOwn(body, field) && typeof rawValue !== "string") {
    errors[field] = "Szöveges értéket adjon meg.";
    return "";
  }
  let value = normalizeCustomOrderText(rawValue ?? "");
  if (!multiline) value = value.replace(/[\n\t]+/g, " ");
  if (required && !value) errors[field] = "A mező kitöltése kötelező.";
  else if (value.length > maxLength) errors[field] = `Legfeljebb ${maxLength} karakter adható meg.`;
  return value;
}

export function validateCustomOrderInput(body, hasFile = false) {
  const errors = Object.create(null);
  validateBody(body, PUBLIC_FIELDS, errors);

  const data = {
    customerName: textField(body, "customerName", 120, errors, { required: true }),
    customerEmail: textField(body, "customerEmail", 254, errors, { required: true }).toLowerCase(),
    customerPhone: textField(body, "customerPhone", 40, errors, { required: true }),
    description: textField(body, "description", 10000, errors, { multiline: true }),
    material: textField(body, "material", 120, errors),
    dimensions: textField(body, "dimensions", 200, errors),
  };

  if (!errors.customerEmail && (
    /[\u0000-\u001f\u007f-\u009f]/.test(body.customerEmail) ||
    /[\u0000-\u0020\u007f-\u009f]/.test(body.customerEmail.trim()) ||
    !validator.isEmail(data.customerEmail, { allow_display_name: false, allow_utf8_local_part: false })
  )) {
    errors.customerEmail = "Érvényes email-címet adjon meg.";
  }
  if (!errors.customerPhone && (
    !/^\+?[0-9 ().-]+$/.test(data.customerPhone) ||
    !/^[0-9]{7,15}$/.test(data.customerPhone.replace(/\D/g, ""))
  )) {
    errors.customerPhone = "Érvényes telefonszámot adjon meg (7–15 számjegy).";
  }

  if (!data.description && !hasFile && !errors.description) {
    errors.description = "Adjon meg leírást, vagy töltsön fel egy modellfájlt.";
  }

  if (body.quantity !== undefined) {
    const value = typeof body.quantity === "string" ? body.quantity.trim() : body.quantity;
    if (value !== "") {
      if (
        !["string", "number"].includes(typeof value) ||
        (typeof value === "string" && !/^[0-9]+$/.test(value)) ||
        !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 10000
      ) {
        errors.quantity = "A mennyiség 1 és 10000 közötti egész szám lehet.";
      } else data.quantity = Number(value);
    }
  }

  if (Object.keys(errors).length) throw validationError(errors);
  return data;
}

export function validateCustomOrderUpdate(body) {
  const errors = Object.create(null);
  validateBody(body, UPDATE_FIELDS, errors);
  const data = {};

  if (Object.hasOwn(body, "status")) {
    data.status = textField(body, "status", 20, errors, { required: true });
    if (!errors.status && !CUSTOM_ORDER_STATUSES.includes(data.status)) {
      errors.status = "Érvénytelen megrendelési állapot.";
    }
  }
  if (Object.hasOwn(body, "adminNotes")) {
    data.adminNotes = textField(body, "adminNotes", 10000, errors, { multiline: true });
  }
  if (!Object.keys(data).length && !Object.keys(errors).length) {
    errors.form = "Adjon meg állapotot vagy belső megjegyzést.";
  }
  if (Object.keys(errors).length) throw validationError(errors);
  return data;
}
