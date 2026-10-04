import { test } from "node:test";
import assert from "node:assert/strict";
import { createFoxpostDirectory, normalizeLocker, normalizeRecipientPhone } from "../services/foxpostService.js";

const point = { place_id: 12345, operator_id: "hu123", variant: "FOXPOST A-BOX", country: "hu", name: "FOXPOST A-BOX Test", address: "1111 Budapest, Teszt utca 1.", street: "Teszt utca 1.", city: "Budapest", zip: "1111", service: ["pick up", "dispatch"], load: "normal loaded", closeDate: "" };
test("accepts Hungarian FOXPOST A-BOX/Z-BOX pickup points and preserves destination code", () => {
  assert.equal(normalizeLocker(point).operator_id, "hu123");
  assert.equal(normalizeLocker({ ...point, variant: "FOXPOST Z-BOX", service: "pick up" }).type, "Z-BOX");
  assert.equal(normalizeLocker({ ...point, closeDate: "2099-01-01" }).country, "HU");
});
test("rejects partner, foreign, overloaded, closed and non-pickup points", () => {
  for (const extra of [{ variant: "Packeta Z-Pont" }, { variant: "Packeta Z-BOX" }, { country: "sk" }, { service: ["dispatch"] }, { load: "overloaded" }, { closeDate: "2020-01-01" }, { closeDate: "invalid" }, { closed: true }, { operator_id: "" }, { zip: "invalid" }]) assert.equal(normalizeLocker({ ...point, ...extra }), null);
});
test("normalizes Hungarian mobile numbers and rejects landline, foreign and malformed input", () => {
  for (const prefix of ["20", "30", "31", "50", "51", "70"]) assert.equal(normalizeRecipientPhone(`06 ${prefix} 123 4567`), `+36${prefix}1234567`);
  for (const value of ["+36 30 123 4567", "06 (30) 123-4567", "0036301234567", "36301234567", "301234567"]) assert.equal(normalizeRecipientPhone(value), "+36301234567");
  for (const value of [null, "", "+3611234567", "+421301234567", "06301234", "abc06301234567", "++36301234567"]) assert.throws(() => normalizeRecipientPhone(value), { statusCode: 400 });
});
test("shares concurrent requests, caches for one hour and rejects expired data after refresh failure", async () => {
  let time = 0, calls = 0, broken = false, signal;
  const directory = createFoxpostDirectory({ now: () => time, fetchList: async (_url, options) => { calls++; signal = options.signal; if (broken) throw new Error("offline"); return { ok: true, json: async () => [point, { ...point, variant: "Packeta Z-Pont" }] }; } });
  const [a, b] = await Promise.all([directory.getLockers(), directory.getLockers()]);
  assert.equal(a, b); assert.equal(a.length, 1); assert.equal(calls, 1); assert.ok(signal instanceof AbortSignal);
  time = 3599999; broken = true;
  assert.equal(await directory.getLockers(), a);
  time = 3600000;
  await assert.rejects(directory.getLockers(), { statusCode: 503 });
  await assert.rejects(directory.getLockers(), { statusCode: 503 });
  broken = false;
  assert.equal((await directory.getLockers()).length, 1);
  assert.equal(calls, 4);
});
test("malformed or unsuccessful list responses fail without caching", async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ points: [] }) }, { ok: true, json: async () => [] }]) {
    await assert.rejects(createFoxpostDirectory({ fetchList: async () => response }).getLockers(), { statusCode: 503 });
  }
});
test("transport is cancelled at the ten-second deadline", async () => {
  let signal;
  const directory = createFoxpostDirectory({ fetchList: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  // Keep the event loop alive: AbortSignal.timeout uses an unreferenced timer.
  const keepAlive = setTimeout(() => {}, 11000);
  try { await assert.rejects(directory.getLockers(), { statusCode: 503 }); assert.equal(signal.aborted, true); }
  finally { clearTimeout(keepAlive); }
});
