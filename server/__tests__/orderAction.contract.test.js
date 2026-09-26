import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "../../client/node_modules/axios/index.js";
import { confirmOrder } from "../../client/src/redux/actions/orderAction.js";

test("confirmOrder sends the canonical orderID field expected by the server contract", async () => {
  const originalPost = axios.post;
  let capturedRequest;

  try {
    axios.post = async (...args) => {
      capturedRequest = args;
      return { data: { _id: "ORDER-123", created: false } };
    };

    const dispatch = (...args) => args;
    const getState = () => ({
      user: {
        userInfo: { token: "abc-token" },
      },
    });

    const result = await confirmOrder("PAYPAL-ORDER-123")(dispatch, getState);

    assert.deepEqual(capturedRequest[0], "/api/orders/confirm");
    assert.deepEqual(capturedRequest[1], { orderID: "PAYPAL-ORDER-123" });
    assert.equal(result._id, "ORDER-123");
  } finally {
    axios.post = originalPost;
  }
});
