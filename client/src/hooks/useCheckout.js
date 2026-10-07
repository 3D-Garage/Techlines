import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRecipientPhone, shippingDraftKey } from "../utils/shipping";

export const checkoutStorageKey = (userId) => `activeCheckout:${userId}`;
export const quoteChangeStorageKey = (userId) => `checkoutQuoteChange:${userId}`;
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
    ...(input.shippingMethod === "foxpost" ? {
      foxpostLockerId: String(input.foxpostLockerId), recipientPhone: normalizeRecipientPhone(input.recipientPhone),
    } : { shippingAddress: Object.fromEntries(["address", "city", "postalCode", "country"].map((field) => {
      const value = input.shippingAddress[field].trim();
      return [field, field === "country" ? value.toUpperCase() : value];
    })) }),
  });
};
const savedInput = (current) => current.quote ? {
  items: current.quote.items,
  shippingMethod: current.quote.shippingMethod,
  shippingAddress: current.shippingAddress,
  foxpostLockerId: current.foxpostLockerId || current.foxpostLocker?.place_id || current.payload?.foxpostLockerId,
  recipientPhone: current.recipientPhone || current.payload?.recipientPhone,
} : current.payload;

export default function useCheckout({ userId, token, onSuccess, onError }) {
  const key = checkoutStorageKey(userId);
  const [active, setActive] = useState(() => read(key));
  const activeRef = useRef(active);
  const quoteKey = quoteChangeStorageKey(userId);
  const [quoteChange, setQuoteChange] = useState(() => read(quoteKey));
  const quoteChangeRef = useRef(quoteChange);
  const successRef = useRef(onSuccess);
  const errorRef = useRef(onError);
  const busy = useRef(false);
  const cancellingRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  successRef.current = onSuccess;
  errorRef.current = onError;
  const persist = useCallback((value) => {
    // Persist before network calls, including the initial creation request.
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
    activeRef.current = value;
    setActive(value);
  }, [key]);
  const persistQuoteChange = useCallback((value) => {
    if (value) localStorage.setItem(quoteKey, JSON.stringify(value));
    else localStorage.removeItem(quoteKey);
    quoteChangeRef.current = value;
    setQuoteChange(value);
  }, [quoteKey]);
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
      error.code = data.code;
      error.quote = data.quote;
      throw error;
    }
    return data;
  }, [token]);
  const rejectCreation = useCallback((error, current) => {
    const latest = activeRef.current;
    if (error.creationRejected && !current.checkoutId && !latest?.checkoutId && latest?.requestId === current.requestId) {
      if (error.code === "QUOTE_CHANGED" && Number.isSafeInteger(error.quote?.total)) {
        persistQuoteChange({ previousTotal: latest.payload?.expectedTotal, quote: error.quote, input: latest.payload, accepted: false });
      }
      persist(null);
      return true;
    }
    return false;
  }, [persist, persistQuoteChange]);
  const accept = useCallback((data, expected) => {
    const previous = activeRef.current;
    if (!previous || (previous.checkoutId && data.checkoutId && previous.checkoutId !== data.checkoutId)) return;
    if (expected && ((expected.requestId && previous.requestId !== expected.requestId) || (expected.checkoutId && previous.checkoutId !== expected.checkoutId))) return;
    if (data.status === "FAILED" && data.issue === "CHECKOUT_CANCELLED") {
      persistQuoteChange(null);
      persist(null);
      return;
    }
    if (data.status === "COMPLETED" && data.order?.paymentStatus === "COMPLETED" && data.order?.paypalCaptureId) {
      persist(null);
      localStorage.removeItem(shippingDraftKey(userId));
      successRef.current(data.order);
      return;
    }
    // Concurrent responses must not move a checkout backwards (READY < PROCESSING < REVIEW).
    const rank = { READY: 0, PROCESSING: 1, REVIEW: 2 };
    const stale = previous.status in rank && data.status in rank && rank[data.status] < rank[previous.status];
    const status = stale ? previous.status : data.status;
    persist({ ...previous, ...data, status });
    persistQuoteChange(null);
  }, [persist, persistQuoteChange, userId]);
  const refresh = useCallback(async () => {
    const current = activeRef.current;
    if (!current || busy.current || cancellingRef.current || ["FAILED", "EXPIRED"].includes(current.status)) return;
    busy.current = true;
    try {
      const data = current.checkoutId ? await request(`/api/checkout/${current.checkoutId}`) : await request("/api/paypal/create-order", current.payload);
      accept(data, current);
    } catch (error) {
      if (rejectCreation(error, current)) errorRef.current(error);
      // Uncertain responses preserve the active payment and cart; the timer retries.
    } finally { busy.current = false; }
  }, [request, accept, rejectCreation]);
  useEffect(() => {
    persist(read(key));
    persistQuoteChange(read(quoteKey));
    void refresh();
    const timer = setInterval(refresh, 5000);
    const sync = (event) => {
      if (event.key === key) persist(read(key));
      if (event.key === quoteKey) persistQuoteChange(read(quoteKey));
    };
    window.addEventListener("storage", sync);
    return () => { clearInterval(timer); window.removeEventListener("storage", sync); };
  }, [key, quoteKey, persist, persistQuoteChange, refresh]);

  const create = async (input, recovery = {}) => {
    if (cancellingRef.current) throw new Error("A fizetés megszakításának ellenőrzése folyamatban.");
    const current = read(key) || activeRef.current;
    if (current?.id && current.status === "READY") {
      if (!savedInput(current) || normalizedInput(input) !== normalizedInput(savedInput(current))) {
        throw new Error("This payment uses the saved checkout items and shipping details. Resume it with those details.");
      }
      persist(current);
      return current.id;
    }
    if (current) throw new Error("An active payment is already being checked.");
    // Read storage too: another tab may have received a changed quote.
    const change = read(quoteKey) || quoteChangeRef.current;
    if (change && (!change.accepted || (normalizedInput(input) === normalizedInput(change.input) && input.expectedTotal !== change.quote.total))) {
      throw new Error("Fogadd el az új összeget a fizetés indításához.");
    }
    const payload = { ...input, requestId: newRequestId() };
    persist({ ...recovery, payload, requestId: payload.requestId, status: "CREATING" });
    busy.current = true;
    try {
      const data = await request("/api/paypal/create-order", payload);
      accept(data, { requestId: payload.requestId });
      if (!data.id) throw new Error("Payment preparation is pending. Please wait for verification.");
      return data.id;
    } catch (error) {
      rejectCreation(error, { requestId: payload.requestId });
      errorRef.current(error);
      throw error;
    } finally { busy.current = false; }
  };
  const approve = async (paypalOrderId) => {
    const current = activeRef.current;
    if (!current?.checkoutId) throw new Error("Missing checkout ID");
    if (cancellingRef.current || (paypalOrderId && paypalOrderId !== current.id)) throw new Error("Ez a PayPal-fizetés már nem az aktív rendeléshez tartozik.");
    persist({ ...current, status: "PROCESSING" });
    try {
      const data = await request("/api/orders/confirm", { checkoutId: current.checkoutId });
      accept(data.paymentStatus === "COMPLETED" ? { status: "COMPLETED", order: data } : data, current);
    } catch (error) { errorRef.current(error); }
  };
  const cancel = async (paypalOrderId) => {
    const current = activeRef.current;
    if (!current?.checkoutId || current.status !== "READY" || cancellingRef.current || (paypalOrderId && paypalOrderId !== current.id)) return;
    cancellingRef.current = true;
    setCancelling(true);
    try {
      const data = await request(`/api/checkout/${current.checkoutId}/cancel`, {});
      accept(data, current);
      if (!["FAILED", "EXPIRED"].includes(data.status)) {
        errorRef.current(new Error("A fizetés ellenőrzést igényel; a rendelés egyelőre nem módosítható."));
      } else if (activeRef.current?.checkoutId === current.checkoutId) {
        // EXPIRED/already-failed attempts are also safe to leave explicitly.
        persistQuoteChange(null);
        persist(null);
      }
    } catch (error) { errorRef.current(error); }
    finally { cancellingRef.current = false; setCancelling(false); }
  };
  const reset = () => {
    if (["FAILED", "EXPIRED"].includes(activeRef.current?.status)) {
      persistQuoteChange(null);
      persist(null);
    }
  };
  const acceptQuote = () => {
    const change = read(quoteKey) || quoteChangeRef.current;
    if (change) persistQuoteChange({ ...change, accepted: true });
  };
  return { active, quoteChange, acceptQuote, cancelling, cancel, create, approve, refresh, reset };
}
