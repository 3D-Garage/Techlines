// Every network request (including token acquisition) has a bounded timeout.
const base = () => process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
async function request(path, options) {
  const response = await fetch(`${base()}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error("PayPal request failed");
    error.providerStatus = response.status;
    error.providerCode = data?.details?.[0]?.issue;
    throw error;
  }
  return data;
}
export async function getAccessToken() {
  const { PAYPAL_CLIENT_ID: client, PAYPAL_CLIENT_SECRET: secret } = process.env;
  if (!client || !secret) throw new Error("Missing PayPal credentials");
  const data = await request("/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!data.access_token) throw new Error("Missing PayPal access token");
  return data.access_token;
}
async function orderRequest(path, { method = "GET", body, requestId } = {}) {
  const token = await getAccessToken();
  return request(`/v2/checkout/orders${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export function normalizePayPalCapture(order) {
  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    orderId: order?.id, captureId: capture?.id, status: capture?.status,
    currency: capture?.amount?.currency_code,
    value: capture?.amount?.value === undefined ? NaN : Number(capture.amount.value),
    merchantId: unit?.payee?.merchant_id, payerId: order?.payer?.payer_id,
    shippingMethod: unit?.custom_id,
  };
}
export const getOrder = (id) => orderRequest(`/${encodeURIComponent(id)}`);
export const captureOrder = (id, requestId) => {
  if (!requestId) throw new Error("Capture request ID is required");
  return orderRequest(`/${encodeURIComponent(id)}/capture`, { method: "POST", requestId, body: {} });
};
export function createOrder({ total, subtotal, shippingPrice, items, shippingAddress, referenceId, merchantId, fullName, requestId, returnUrl, cancelUrl }) {
  return orderRequest("", { method: "POST", requestId, body: {
    intent: "CAPTURE",
    payment_source: { paypal: { experience_context: {
      shipping_preference: "SET_PROVIDED_ADDRESS",
      ...(returnUrl ? { return_url: returnUrl } : {}),
      ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
    } } },
    purchase_units: [{
      reference_id: referenceId, custom_id: referenceId, payee: { merchant_id: merchantId },
      amount: { currency_code: "HUF", value: String(total), breakdown: {
        item_total: { currency_code: "HUF", value: String(subtotal) },
        shipping: { currency_code: "HUF", value: String(shippingPrice) },
      } },
      items: items.map((item) => ({ name: item.name.slice(0, 127), quantity: String(item.qty), sku: String(item.productId), unit_amount: { currency_code: "HUF", value: String(item.unitPrice) } })),
      shipping: { name: { full_name: fullName }, address: { address_line_1: shippingAddress.address, admin_area_2: shippingAddress.city, postal_code: shippingAddress.postalCode, country_code: shippingAddress.country } },
    }],
  } });
}
