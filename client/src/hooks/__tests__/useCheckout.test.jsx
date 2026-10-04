import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useCheckout, { checkoutStorageKey, quoteChangeStorageKey } from "../useCheckout";
const input = { expectedTotal: 2490, items: [{ productId: "product", qty: 1 }], shippingMethod: "standard", shippingAddress: { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" } };
const key = checkoutStorageKey("owner");
let onSuccess, onError;
function Harness({ userId = "owner", checkoutInput = input, onCreateError = () => {}, paypalOrderId }) {
  const checkout = useCheckout({ userId, token: "token", onSuccess, onError });
  return <div><span>{checkout.active?.status || "IDLE"}</span>
    <button onClick={() => checkout.create(checkoutInput).catch(onCreateError)}>Create</button>
    <button onClick={() => checkout.approve(paypalOrderId).catch(() => {})}>Approve</button>
    <button onClick={() => checkout.cancel(paypalOrderId)}>Cancel</button>
    <button onClick={checkout.refresh}>Refresh</button>
    <button onClick={checkout.acceptQuote}>Accept quote</button>
    {checkout.quoteChange && <span>{checkout.quoteChange.accepted ? "ACCEPTED" : "QUOTE_CHANGED"}</span>}
    <button onClick={checkout.reset}>Reset</button></div>;
}
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  let requestNumber = 42;
  Object.defineProperty(window, "crypto", { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(requestNumber++) } });
  localStorage.clear();
  onSuccess = jest.fn(); onError = jest.fn();
  global.fetch = jest.fn();
});
test("sends the webshop address and persists request identity before creation", async () => {
  fetch.mockImplementation(async (_url, options) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const body = JSON.parse(options.body);
    expect(saved.requestId).toBe(body.requestId);
    expect(body.shippingAddress).toEqual(input.shippingAddress);
    return response({ checkoutId: "checkout", id: "paypal", status: "READY" });
  });
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(await screen.findByText("READY")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(key)).checkoutId).toBe("checkout");
});
test("202 confirmation preserves the active checkout and never calls success", async () => {
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", id: "paypal", status: "READY" }))
    .mockResolvedValueOnce(response({ checkoutId: "checkout", status: "PROCESSING" }, 202));
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); }); await screen.findByText("READY");
  await act(async () => { fireEvent.click(screen.getByText("Approve")); });
  await screen.findByText("PROCESSING");
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ checkoutId: "checkout" });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).not.toBeNull();
});
test("reload resumes status polling and a verified completion clears storage", async () => {
  localStorage.setItem(key, JSON.stringify({ checkoutId: "checkout", status: "PROCESSING" }));
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", status: "PROCESSING" }))
    .mockResolvedValueOnce(response({ checkoutId: "checkout", status: "COMPLETED", order: { paymentStatus: "COMPLETED", paypalCaptureId: "capture" } }));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/checkout/checkout", expect.anything()));
  await act(async () => {});
  await waitFor(() => expect(JSON.parse(localStorage.getItem(key)).status).toBe("PROCESSING"));
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(key)).toBeNull();
});
test("lost creation response replays the same persisted payload on reload", async () => {
  fetch.mockRejectedValueOnce(new Error("Network failed"));
  const view = render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await waitFor(() => expect(onError).toHaveBeenCalled());
  const first = JSON.parse(fetch.mock.calls[0][1].body);
  view.unmount();
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", id: "paypal", status: "READY" }));
  render(<Harness />);
  await screen.findByText("READY");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(first);
});
test("uncertain status and incomplete success responses preserve the payment", async () => {
  localStorage.setItem(key, JSON.stringify({ checkoutId: "checkout", status: "REVIEW" }));
  fetch.mockRejectedValueOnce(new Error("timeout"));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(localStorage.getItem(key)).not.toBeNull();
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", status: "COMPLETED" }));
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(onSuccess).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).not.toBeNull();
});
test("active payments are scoped to the logged-in account", () => {
  localStorage.setItem(key, JSON.stringify({ checkoutId: "foreign", status: "PROCESSING" }));
  render(<Harness userId="other" />);
  expect(screen.getByText("IDLE")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([400, 404, 409, 422])("a definitive creation rejection (%s) allows a corrected checkout", async (status) => {
  fetch.mockResolvedValueOnce(response({ message: "Checkout rejected", creationRejected: true }, status))
    .mockResolvedValueOnce(response({ checkoutId: "checkout", id: "paypal", status: "READY" }));
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(localStorage.getItem(key)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await screen.findByText("READY");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([404, 409])("reload clears a definitively rejected creation (%s) without endless retries", async (status) => {
  localStorage.setItem(key, JSON.stringify({ requestId: "original-request", payload: { ...input, requestId: "original-request" }, status: "CREATING" }));
  fetch.mockResolvedValueOnce(response({ message: "Checkout rejected", creationRejected: true }, status));
  render(<Harness />);
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  expect(onError).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([401, 409, 500, 503])("an uncertain or conflicting creation (%s) preserves its request identity", async (status) => {
  fetch.mockResolvedValue(response({ message: "Try again later" }, status));
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  const saved = localStorage.getItem(key);
  expect(saved).not.toBeNull();
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  expect(localStorage.getItem(key)).toBe(saved);
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
});

test("a known checkout is retained even if a status error claims creation rejection", async () => {
  const saved = JSON.stringify({ checkoutId: "checkout", requestId: "original-request", status: "PROCESSING" });
  localStorage.setItem(key, saved);
  fetch.mockResolvedValue(response({ message: "Not found", creationRejected: true }, 404));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(key)).toBe(saved);
});

test("a REVIEW response to a recovered creation retains the checkout ID", async () => {
  localStorage.setItem(key, JSON.stringify({ requestId: "original-request", payload: input, status: "CREATING" }));
  fetch.mockResolvedValue(response({ checkoutId: "checkout", status: "REVIEW" }, 409));
  render(<Harness />);
  await screen.findByText("REVIEW");
  expect(JSON.parse(localStorage.getItem(key)).checkoutId).toBe("checkout");
});

test.each([
  { ...input, items: [{ productId: "other-product", qty: 1 }] },
  { ...input, items: [{ productId: "product", qty: 2 }] },
  { ...input, shippingMethod: "express" },
  { ...input, shippingAddress: { ...input.shippingAddress, address: "New address 2" } },
])("a READY payment cannot be silently reused with changed input (%j)", async (checkoutInput) => {
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY", payload: input };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValue(response(saved));
  const onCreateError = jest.fn();
  render(<Harness checkoutInput={checkoutInput} onCreateError={onCreateError} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(onCreateError.mock.calls[0][0].message).toMatch(/saved checkout/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(key)).id).toBe("paypal");
});

test("equivalent normalized items and addresses resume the same READY payment", async () => {
  const payload = { ...input, items: [{ productId: "ABC", qty: 1 }, { productId: "abc", qty: 1 }] };
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY", payload };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValue(response(saved));
  const onCreateError = jest.fn();
  render(<Harness checkoutInput={{ ...input, items: [{ productId: "abc", qty: "2" }], shippingAddress: { ...input.shippingAddress, address: ` ${input.shippingAddress.address} `, country: "hu" } }} onCreateError={onCreateError} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(onCreateError).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("concurrent polling and confirmation completion consume the cart only once", async () => {
  localStorage.setItem(key, JSON.stringify({ checkoutId: "checkout", status: "READY" }));
  let finishLookup;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { finishLookup = resolve; }))
    .mockResolvedValueOnce(response({ paymentStatus: "COMPLETED", paypalCaptureId: "capture" }));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Approve")); });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  await act(async () => { finishLookup(response({ checkoutId: "checkout", status: "COMPLETED", order: { paymentStatus: "COMPLETED", paypalCaptureId: "capture" } })); });
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

test("polling waits for the initial creation request before attempting recovery", async () => {
  let finishCreation;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { finishCreation = resolve; }));
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { finishCreation(response({ checkoutId: "checkout", id: "paypal", status: "READY" })); });
  await screen.findByText("READY");
});

const foxpostInput = { items: input.items, shippingMethod: "foxpost", foxpostLockerId: "12345", recipientPhone: "06 30 123 4567" };

test("verified cancellation clears READY recovery, retains shipping drafts and allows a new request", async () => {
  const saved = { checkoutId: "checkout", id: "paypal", requestId: "old-request", status: "READY", payload: foxpostInput };
  localStorage.setItem(key, JSON.stringify(saved));
  localStorage.setItem("shippingDraft:owner", JSON.stringify(foxpostInput));
  fetch.mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response({ checkoutId: "checkout", status: "FAILED", issue: "CHECKOUT_CANCELLED" }))
    .mockResolvedValueOnce(response({ checkoutId: "new-checkout", id: "new-paypal", status: "READY" }));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
  expect(localStorage.getItem(key)).toBeNull();
  expect(JSON.parse(localStorage.getItem("shippingDraft:owner"))).toEqual(foxpostInput);
  expect(fetch.mock.calls[1][0]).toBe("/api/checkout/checkout/cancel");
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(JSON.parse(localStorage.getItem(key)).checkoutId).toBe("new-checkout");
  expect(JSON.parse(fetch.mock.calls[2][1].body).requestId).not.toBe("old-request");
  expect(onSuccess).not.toHaveBeenCalled();
});

test.each([409, 503])("uncertain cancellation %s retains the active checkout", async (status) => {
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY" };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response({ message: "Cannot verify cancellation" }, status));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
  expect(JSON.parse(localStorage.getItem(key)).checkoutId).toBe("checkout");
  expect(onError).toHaveBeenCalled();
});

test("lost cancellation response is recovered by status polling", async () => {
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY" };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValueOnce(response(saved)).mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(response({ checkoutId: "checkout", status: "FAILED", issue: "CHECKOUT_CANCELLED" }));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
  expect(localStorage.getItem(key)).not.toBeNull();
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  expect(localStorage.getItem(key)).toBeNull();
});

test("provider evidence returned by cancellation keeps REVIEW locked", async () => {
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY" };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response({ checkoutId: "checkout", status: "REVIEW", issue: "CAPTURE_WITHOUT_RESERVATION" }, 409));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
  expect(JSON.parse(localStorage.getItem(key)).status).toBe("REVIEW");
  expect(onSuccess).not.toHaveBeenCalled();
});

test.each(["CREATING", "PROCESSING", "REVIEW"])("local %s cannot be discarded through cancellation", async (status) => {
  const saved = { checkoutId: "checkout", status };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValueOnce(response(saved));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(key)).status).toBe(status);
});

test("late PayPal callbacks from an abandoned order cannot cancel or capture the next checkout", async () => {
  const saved = { checkoutId: "new-checkout", id: "new-paypal", status: "READY" };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValueOnce(response(saved));
  render(<Harness paypalOrderId="old-paypal" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); fireEvent.click(screen.getByText("Approve")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(key)).checkoutId).toBe("new-checkout");
});

test("a late old status lookup cannot resurrect the cancelled checkout over a new request", async () => {
  const saved = { checkoutId: "checkout", id: "paypal", requestId: "old-request", status: "READY" };
  localStorage.setItem(key, JSON.stringify(saved));
  let finishLookup;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { finishLookup = resolve; }))
    .mockResolvedValueOnce(response({ checkoutId: "checkout", status: "FAILED", issue: "CHECKOUT_CANCELLED" }))
    .mockResolvedValueOnce(response({ checkoutId: "new-checkout", id: "new-paypal", status: "READY" }));
  render(<Harness />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await act(async () => { finishLookup(response(saved)); });
  expect(JSON.parse(localStorage.getItem(key)).checkoutId).toBe("new-checkout");
});
test("FOXPOST creation persists only the selected locker ID and phone and restores them after reload", async () => {
  fetch.mockRejectedValueOnce(new Error("network failure"));
  const view = render(<Harness checkoutInput={foxpostInput} />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.foxpostLockerId).toBe("12345");
  expect(payload.shippingAddress).toBeUndefined();
  expect(JSON.parse(localStorage.getItem(key)).payload.recipientPhone).toBe(foxpostInput.recipientPhone);
  view.unmount();
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", id: "paypal", status: "READY", foxpostLockerId: "12345", recipientPhone: "+36301234567" }));
  render(<Harness checkoutInput={foxpostInput} />);
  await screen.findByText("READY");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(payload);
  expect(JSON.parse(localStorage.getItem(key)).recipientPhone).toBe("+36301234567");
});

test.each([{ foxpostLockerId: "999" }, { recipientPhone: "+36701234567" }])("saved FOXPOST payments reject changed locker or phone (%j)", async (extra) => {
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY", quote: { items: input.items, shippingMethod: "foxpost" }, foxpostLocker: { place_id: "12345" }, recipientPhone: "+36301234567" };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValue(response(saved));
  const onCreateError = jest.fn();
  render(<Harness checkoutInput={{ ...foxpostInput, ...extra }} onCreateError={onCreateError} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(onCreateError.mock.calls[0][0].message).toMatch(/saved checkout/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("equivalent normalized FOXPOST phone resumes without fetching the locker list", async () => {
  const saved = { checkoutId: "checkout", id: "paypal", status: "READY", payload: foxpostInput, quote: { items: input.items, shippingMethod: "foxpost" }, foxpostLockerId: "12345", recipientPhone: "+36301234567" };
  localStorage.setItem(key, JSON.stringify(saved));
  fetch.mockResolvedValue(response(saved));
  const onCreateError = jest.fn();
  render(<Harness checkoutInput={{ ...foxpostInput, recipientPhone: "0036301234567" }} onCreateError={onCreateError} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(onCreateError).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a definitive FOXPOST directory failure unlocks checkout and preserves the shipping draft", async () => {
  localStorage.setItem("shippingDraft:owner", JSON.stringify(foxpostInput));
  fetch.mockResolvedValueOnce(response({ message: "List unavailable", creationRejected: true }, 503));
  render(<Harness checkoutInput={foxpostInput} />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(localStorage.getItem(key)).toBeNull();
  expect(JSON.parse(localStorage.getItem("shippingDraft:owner"))).toEqual(foxpostInput);
});

test.each([1990, 3490])("changed quote %s survives reload and blocks retry until acceptance", async (total) => {
  const updatedQuote = { items: input.items, shippingMethod: "standard", total };
  fetch.mockResolvedValueOnce(response({ code: "QUOTE_CHANGED", quote: updatedQuote, creationRejected: true }, 409));
  const view = render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await screen.findByText("QUOTE_CHANGED");
  const firstPayload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(localStorage.getItem(key)).toBeNull();
  expect(onError.mock.calls[0][0].quote).toEqual(updatedQuote);
  view.unmount();
  const onCreateError = jest.fn();
  render(<Harness checkoutInput={{ ...input, expectedTotal: total }} onCreateError={onCreateError} />);
  await screen.findByText("QUOTE_CHANGED");
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); fireEvent.click(screen.getByText("Create")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onCreateError).toHaveBeenCalled();
  fireEvent.click(screen.getByText("Accept quote"));
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", id: "paypal", status: "READY" }));
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await screen.findByText("READY");
  const acceptedPayload = JSON.parse(fetch.mock.calls[1][1].body);
  expect(acceptedPayload.expectedTotal).toBe(total);
  expect(acceptedPayload.requestId).not.toBe(firstPayload.requestId);
  expect(localStorage.getItem(quoteChangeStorageKey("owner"))).toBeNull();
});

test("a recovered lost creation response can require quote acceptance without another automatic retry", async () => {
  localStorage.setItem(key, JSON.stringify({ requestId: "old-request", payload: { ...input, requestId: "old-request" }, status: "CREATING" }));
  fetch.mockResolvedValueOnce(response({ code: "QUOTE_CHANGED", quote: { total: 3490 }, creationRejected: true }, 409));
  render(<Harness />);
  await screen.findByText("QUOTE_CHANGED");
  expect(JSON.parse(localStorage.getItem(quoteChangeStorageKey("owner"))).previousTotal).toBe(2490);
  await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each(["FAILED", "EXPIRED"])("%s requires explicit reset and the next start uses a new request", async (status) => {
  const payload = { ...foxpostInput, expectedTotal: 2490, requestId: "old-request" };
  localStorage.setItem(key, JSON.stringify({ payload, requestId: payload.requestId, status }));
  const onCreateError = jest.fn();
  render(<Harness checkoutInput={{ ...foxpostInput, expectedTotal: 2490 }} onCreateError={onCreateError} />);
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  expect(fetch).not.toHaveBeenCalled();
  expect(onCreateError).toHaveBeenCalled();
  fireEvent.click(screen.getByText("Reset"));
  fetch.mockResolvedValueOnce(response({ checkoutId: "checkout", id: "paypal", status: "READY" }));
  await act(async () => { fireEvent.click(screen.getByText("Create")); });
  await screen.findByText("READY");
  expect(JSON.parse(fetch.mock.calls[0][1].body).requestId).not.toBe("old-request");
});
