// Simple PayPal REST client using global fetch (Node 18+)
// In tests we will mock these functions via paypalRoutes' __setPayPalService

const PAYPAL_BASE = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

export async function getAccessToken() {
  const client = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!client || !secret) throw new Error("Missing PayPal credentials");
  const auth = Buffer.from(`${client}:${secret}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("PayPal auth response parse error");
  }
  return data.access_token;
}

export async function createOrder({ total, currency = "HUF", referenceId }) {
  const accessToken = await getAccessToken();
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: referenceId || "order",
        amount: { currency_code: currency, value: String(total) },
      },
    ],
  };
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PayPal order create failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { id: undefined, raw: text };
  }
}

export async function captureOrder(orderId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PayPal order capture failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
