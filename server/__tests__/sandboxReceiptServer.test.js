import { test } from "node:test";
import assert from "node:assert/strict";
import { startSandboxReceiptServer } from "../scripts/sandboxReceiptServer.js";

test("Sandbox browser receipt has real return/cancel targets and requires verified success before acknowledgment", async () => {
  let status = "PROCESSING";
  let acknowledged = false;
  const server = await startSandboxReceiptServer({ readStatus: async () => status, onReceipt: () => { acknowledged = true; } });
  const base = server.returnUrl.replace(/return$/, "");
  try {
    const returned = await fetch(server.returnUrl + "?token=test-order&PayerID=test-payer");
    assert.equal(returned.status, 200);
    assert.match(returned.headers.get("content-type"), /text\/html/);
    assert.match(await returned.text(), /role="status"/);
    assert.equal((await fetch(`${base}receipt`, { method: "POST" })).status, 404);
    assert.equal(acknowledged, false);
    assert.deepEqual(await (await fetch(`${base}status`)).json(), { status: "PROCESSING" });
    status = "COMPLETED";
    assert.deepEqual(await (await fetch(`${base}status`)).json(), { status: "COMPLETED" });
    assert.equal((await fetch(`${base}receipt`, { method: "POST" })).status, 204);
    assert.equal(acknowledged, true);
    assert.equal((await fetch(server.cancelUrl)).status, 200);
  } finally { await server.close(); }
});
