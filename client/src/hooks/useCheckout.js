import { useCallback, useEffect, useRef, useState } from "react";

export const checkoutStorageKey = (userId) => `activeCheckout:${userId}`;
const newRequestId = () => Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_error) { return null; }
};
const normalizedInput = (input) => {
  const grouped = new Map();
  for (const item of input.items) {
    const id = String(item.productId).trim().toLowerCase();
    grouped.set(id, (grouped.get(id) || 0) + Number(item.qty));
  }
  return JSON.stringify({
    items: [...grouped].sort(([a], [b]) => a.localeCompare(b)),
    shippingMethod: input.shippingMethod,
    shippingAddress: Object.fromEntries(["address", "city", "postalCode", "country"].map((field) => {
      const value = input.shippingAddress[field].trim();
      return [field, field === "country" ? value.toUpperCase() : value];
    })),
  });
};
const savedInput = (current) => current.quote ? {
  items: current.quote.items,
  shippingMethod: current.quote.shippingMethod,
  shippingAddress: current.shippingAddress,
} : current.payload;

export default function useCheckout({ userId, token, onSuccess, onError }) {
  const key = checkoutStorageKey(userId);
  const [active, setActive] = useState(() => read(key));
  const activeRef = useRef(active);
  const successRef = useRef(onSuccess);
  const errorRef = useRef(onError);
  const busy = useRef(false);
  successRef.current = onSuccess;
  errorRef.current = onError;
  const persist = useCallback((value) => {
    // Persist before network calls, including the initial creation request.
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
    activeRef.current = value;
    setActive(value);
  }, [key]);
  const request = useCallback(async (url, body) => {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok && !(response.status === 409 && data.checkoutId && ["FAILED", "EXPIRED", "REVIEW"].includes(data.status))) {
      const error = new Error(data.message || "Payment status could not be verified. We will check again.");
      error.statusCode = response.status;
      error.creationRejected = data.creationRejected === true;
      throw error;
    }
    return data;
  }, [token]);
  const rejectCreation = useCallback((error, current) => {
    const latest = activeRef.current;
    if (error.creationRejected && !current.checkoutId && !latest?.checkoutId && latest?.requestId === current.requestId) {
      persist(null);
      return true;
    }
    return false;
  }, [persist]);
  const accept = useCallback((data) => {
    const previous = activeRef.current;
    if (!previous || (previous.checkoutId && data.checkoutId && previous.checkoutId !== data.checkoutId)) return;
    if (data.status === "COMPLETED" && data.order?.paymentStatus === "COMPLETED" && data.order?.paypalCaptureId) {
      persist(null);
      successRef.current(data.order);
      return;
    }
    // A concurrent status GET may arrive just before the confirmation POST.
    const status = previous.status === "PROCESSING" && data.status === "READY" ? "PROCESSING" : data.status;
    persist({ ...previous, ...data, status });
  }, [persist]);
  const refresh = useCallback(async () => {
    const current = activeRef.current;
    if (!current || busy.current || ["FAILED", "EXPIRED"].includes(current.status)) return;
    busy.current = true;
    try {
      const data = current.checkoutId ? await request(`/api/checkout/${current.checkoutId}`) : await request("/api/paypal/create-order", current.payload);
      accept(data);
    } catch (error) {
      if (rejectCreation(error, current)) errorRef.current(error);
      // Uncertain responses preserve the active payment and cart; the timer retries.
    } finally { busy.current = false; }
  }, [request, accept, rejectCreation]);
  useEffect(() => {
    persist(read(key));
    void refresh();
    const timer = setInterval(refresh, 5000);
    const sync = (event) => { if (event.key === key) persist(read(key)); };
    window.addEventListener("storage", sync);
    return () => { clearInterval(timer); window.removeEventListener("storage", sync); };
  }, [key, persist, refresh]);

  const create = async (input) => {
    const current = read(key) || activeRef.current;
    if (current?.id && current.status === "READY") {
      if (!savedInput(current) || normalizedInput(input) !== normalizedInput(savedInput(current))) {
        throw new Error("This payment uses the saved checkout items and shipping details. Resume it with those details.");
      }
      persist(current);
      return current.id;
    }
    if (current) throw new Error("An active payment is already being checked.");
    const payload = { ...input, requestId: newRequestId() };
    persist({ payload, requestId: payload.requestId, status: "CREATING" });
    busy.current = true;
    try {
      const data = await request("/api/paypal/create-order", payload);
      accept(data);
      if (!data.id) throw new Error("Payment preparation is pending. Please wait for verification.");
      return data.id;
    } catch (error) {
      rejectCreation(error, { requestId: payload.requestId });
      errorRef.current(error);
      throw error;
    } finally { busy.current = false; }
  };
  const approve = async () => {
    const current = activeRef.current;
    if (!current?.checkoutId) throw new Error("Missing checkout ID");
    persist({ ...current, status: "PROCESSING" });
    try {
      const data = await request("/api/orders/confirm", { checkoutId: current.checkoutId });
      accept(data.paymentStatus === "COMPLETED" ? { status: "COMPLETED", order: data } : data);
    } catch (error) { errorRef.current(error); }
  };
  const reset = () => {
    if (["FAILED", "EXPIRED"].includes(activeRef.current?.status)) persist(null);
  };
  return { active, create, approve, refresh, reset };
}
