import { test } from "node:test";
import assert from "node:assert/strict";
import { rejectDirectOrderCreation } from "../routes/orderRoutes.js";

test("direct local order creation is rejected", () => {
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };

  assert.throws(
    () => rejectDirectOrderCreation({}, res),
    /confirming a verified PayPal payment/
  );
  assert.equal(res.statusCode, 405);
});
