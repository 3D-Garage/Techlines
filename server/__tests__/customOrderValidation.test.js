import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_ORDER_STATUSES, validateCustomOrderInput, validateCustomOrderUpdate,
} from "../services/customOrderValidation.js";

const validInput = (overrides = {}) => ({
  customerName: "Kovács Anna",
  customerEmail: "anna@example.com",
  customerPhone: "+36 30 123 4567",
  description: "Egy tartókonzolt szeretnék.",
  ...overrides,
});

function rejectsField(action, field) {
  assert.throws(action, (error) => {
    assert.equal(error.status, 400);
    assert.equal(typeof error.message, "string");
    assert.equal(typeof error.errors[field], "string");
    return true;
  });
}

test("customer request normalizes contact details and preserves literal multiline text", () => {
  const input = validateCustomOrderInput(validInput({
    customerName: "  Kova\u0301cs Anna  ",
    customerEmail: " ANNA@EXAMPLE.COM ",
    description: "  Első sor\r\nMásodik\u0000 sor <script>alert('x')</script>  ",
    material: "  PLA  ",
    dimensions: "  20 × 40 mm ",
    quantity: " 12 ",
  }));
  assert.equal(input.customerName, "Kovács Anna");
  assert.equal(input.customerEmail, "anna@example.com");
  assert.equal(input.description, "Első sor\nMásodik sor <script>alert('x')</script>");
  assert.equal(input.material, "PLA");
  assert.equal(input.dimensions, "20 × 40 mm");
  assert.equal(input.quantity, 12);
});

test("description-only and model-only requests are accepted, but neither is rejected", () => {
  assert.equal(validateCustomOrderInput(validInput(), false).description, "Egy tartókonzolt szeretnék.");
  assert.equal(validateCustomOrderInput(validInput({ description: "" }), true).description, "");
  rejectsField(() => validateCustomOrderInput(validInput({ description: " \r\n " }), false), "description");
});

test("all contact fields are required", () => {
  for (const field of ["customerName", "customerEmail", "customerPhone"]) {
    rejectsField(() => validateCustomOrderInput(validInput({ [field]: " " })), field);
  }
});

test("invalid emails, header injection and embedded controls are rejected", () => {
  for (const email of ["not-an-email", "Name <anna@example.com>", "anna@example.com\r\nBcc: other@example.com", "anna@example.com\r\n", "an\u0000na@example.com", "anna @example.com"]) {
    rejectsField(() => validateCustomOrderInput(validInput({ customerEmail: email })), "customerEmail");
  }
});

test("phone validation requires a bounded digit count and normal phone syntax", () => {
  for (const phone of ["123456", "1234567890123456", "call 123456789", "+36+301234567", "1".repeat(41)]) {
    rejectsField(() => validateCustomOrderInput(validInput({ customerPhone: phone })), "customerPhone");
  }
  assert.equal(validateCustomOrderInput(validInput({ customerPhone: "+36 (30) 123-4567" })).customerPhone, "+36 (30) 123-4567");
});

test("public input rejects arrays, objects and null in text fields", () => {
  for (const field of ["customerName", "customerEmail", "customerPhone", "description", "material", "dimensions"]) {
    for (const value of [[], { $ne: "" }, null, 17]) {
      rejectsField(() => validateCustomOrderInput(validInput({ [field]: value }), true), field);
    }
  }
});

test("field length limits apply to all public text fields", () => {
  const limits = { customerName: 120, customerEmail: 254, customerPhone: 40, description: 10000, material: 120, dimensions: 200 };
  for (const [field, limit] of Object.entries(limits)) {
    rejectsField(() => validateCustomOrderInput(validInput({ [field]: "x".repeat(limit + 1) })), field);
  }
});

test("quantity is optional and accepts only bounded integers", () => {
  assert.equal(Object.hasOwn(validateCustomOrderInput(validInput({ quantity: "" })), "quantity"), false);
  for (const quantity of [1, "1", 10000, "10000"]) {
    assert.equal(validateCustomOrderInput(validInput({ quantity })).quantity, Number(quantity));
  }
  for (const quantity of [0, -1, 10001, 1.5, "1.5", "1e2", "abc", NaN, Infinity, [], {}, null, true]) {
    rejectsField(() => validateCustomOrderInput(validInput({ quantity })), "quantity");
  }
});

test("public input prevents mass assignment and handles prototype-like field names", () => {
  for (const field of ["status", "adminNotes", "modelFile", "createdAt", "notification"]) {
    rejectsField(() => validateCustomOrderInput(validInput({ [field]: "injected" })), field);
  }
  const input = JSON.parse(JSON.stringify(validInput()).replace(/}$/, ',"__proto__":"injected"}'));
  rejectsField(() => validateCustomOrderInput(input), "__proto__");
});

test("request bodies must be objects", () => {
  for (const body of [null, undefined, [], "text", 3]) {
    rejectsField(() => validateCustomOrderInput(body), "form");
    rejectsField(() => validateCustomOrderUpdate(body), "form");
  }
});

test("admin update accepts the defined statuses and independent notes edits", () => {
  for (const status of CUSTOM_ORDER_STATUSES) assert.deepEqual(validateCustomOrderUpdate({ status }), { status });
  assert.deepEqual(validateCustomOrderUpdate({ adminNotes: "  Belső\r\nmegjegyzés <b>szöveg</b> " }), { adminNotes: "Belső\nmegjegyzés <b>szöveg</b>" });
  assert.deepEqual(validateCustomOrderUpdate({ status: "review", adminNotes: "" }), { status: "review", adminNotes: "" });
});

test("admin update rejects unknown status, fields, invalid notes and empty patches", () => {
  rejectsField(() => validateCustomOrderUpdate({}), "form");
  for (const status of ["unknown", "", [], { $set: "review" }]) rejectsField(() => validateCustomOrderUpdate({ status }), "status");
  for (const adminNotes of [undefined, null, [], {}, 3, "x".repeat(10001)]) rejectsField(() => validateCustomOrderUpdate({ adminNotes }), "adminNotes");
  rejectsField(() => validateCustomOrderUpdate({ status: "new", customerEmail: "other@example.com" }), "customerEmail");
});
