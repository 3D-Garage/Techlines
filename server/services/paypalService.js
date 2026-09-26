// Simple PayPal REST client using global fetch (Node 18+)
// In tests we will mock these functions via paypalRoutes' __setPayPalService

const getPayPalBaseUrl = () =>
  (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/$/, "");

const getRequestSignal = () => {
  const configured = Number(process.env.PAYPAL_REQUEST_TIMEOUT_MS || 10000);
  const timeoutMs = Number.isFinite(configured)
    ? Math.min(Math.max(configured, 1000), 15000)
    : 10000;
  return AbortSignal.timeout(timeoutMs);
};

const parseResponse = async (res, operation) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${operation} failed with status ${res.status}`);
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`PayPal ${operation} returned an invalid response`);
  }
};

const requireRequestId = (requestId) => {
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 38) {
    throw new Error("A valid PayPal request ID is required");
  }
};

export async function getAccessToken() {
  const client = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!client || !secret) throw new Error("Missing PayPal credentials");
  const auth = Buffer.from(`${client}:${secret}`).toString("base64");
  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: getRequestSignal(),
  });
  const data = await parseResponse(res, "authentication");
  if (!data.access_token) throw new Error("PayPal authentication returned an invalid response");
  return data.access_token;
}

export async function createOrder({
  total,
  currency = "HUF",
  referenceId,
  customId,
  requestId,
}) {
  requireRequestId(requestId);
  const accessToken = await getAccessToken();
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: referenceId || "order",
        custom_id: customId,
        amount: { currency_code: currency, value: String(total) },
      },
    ],
  };
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": requestId,
    },
    body: JSON.stringify(body),
    signal: getRequestSignal(),
  });
  return parseResponse(res, "order creation");
}

export async function getOrder(orderId) {
  if (typeof orderId !== "string" || !orderId) throw new Error("A PayPal order ID is required");
  const accessToken = await getAccessToken();
  const res = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      signal: getRequestSignal(),
    }
  );
  return parseResponse(res, "order retrieval");
}

export async function captureOrder(orderId, requestId) {
  if (typeof orderId !== "string" || !orderId) throw new Error("A PayPal order ID is required");
  requireRequestId(requestId);
  const accessToken = await getAccessToken();
  const res = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": requestId,
      },
      body: JSON.stringify({}),
      signal: getRequestSignal(),
    }
  );
  return parseResponse(res, "order capture");
}
