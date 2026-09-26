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

export function normalizePayPalCapture(capture) {
  const purchaseUnit = Array.isArray(capture?.purchase_units) ? (capture.purchase_units[0] ?? {}) : {};
  const paymentCapture = Array.isArray(purchaseUnit?.payments?.captures)
    ? (purchaseUnit.payments.captures[0] ?? {})
    : {};
  const amount = paymentCapture.amount || purchaseUnit.amount || capture?.amount || {};
  const amountValue = Number(amount.value ?? 0);
  const captureId = paymentCapture.id || capture?.id || null;
  const orderId =
    capture?.id === captureId
      ? capture?.purchase_units?.[0]?.reference_id || capture?.id
      : capture?.id || purchaseUnit?.reference_id || null;

  return {
    orderId: capture?.id || purchaseUnit?.reference_id || null,
    captureId,
    status: paymentCapture.status || capture?.status || "UNKNOWN",
    currency: amount.currency_code || amount.currency || "HUF",
    amount: {
      value: String(amount.value ?? amountValue ?? "0"),
      currency_code: amount.currency_code || amount.currency || "HUF",
    },
    value: amountValue,
    items: Array.isArray(purchaseUnit.items) ? purchaseUnit.items : [],
    shippingMethod: purchaseUnit.custom_id || capture?.custom_id || "standard",
    shippingAddress: purchaseUnit.shipping || capture?.shipping || null,
    payerId: capture?.payer?.payer_id || purchaseUnit?.payee?.merchant_id || null,
    raw: capture,
  };
}

export async function getOrder(orderId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PayPal order lookup failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function createOrder({
  total,
  currency = "HUF",
  referenceId,
  items = [],
  shippingMethod = "standard",
  shippingAddress,
}) {
  const accessToken = await getAccessToken();
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => {
        const productId = item?.productId ?? item?.product_id ?? item?.id ?? item?._id ?? null;
        return {
          name: String(item?.name || "Product"),
          quantity: String(Number(item?.qty ?? item?.quantity ?? 1)),
          sku: productId ? String(productId) : undefined,
          unit_amount: {
            currency_code: currency,
            value: String(Number(item?.unitPrice ?? item?.price ?? 0)),
          },
        };
      })
    : [];

  const purchaseUnit = {
    reference_id: referenceId || "order",
    custom_id: shippingMethod,
    amount: { currency_code: currency, value: String(total) },
  };

  if (normalizedItems.length) purchaseUnit.items = normalizedItems;
  if (shippingAddress && shippingAddress.address) {
    purchaseUnit.shipping = {
      address: {
        address_line_1: shippingAddress.address,
        admin_area_2: shippingAddress.city,
        postal_code: shippingAddress.postalCode,
        country_code: shippingAddress.country || "HU",
      },
    };
  }

  const body = { intent: "CAPTURE", purchase_units: [purchaseUnit] };
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

export async function captureOrder(orderId, requestId = `confirm-${orderId}`) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": requestId,
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
