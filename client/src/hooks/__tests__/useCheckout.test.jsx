import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useCheckout, { checkoutStorageKey } from "../useCheckout";
const input = { items: [{ productId: "product", qty: 1 }], shippingMethod: "standard", shippingAddress: { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" } };
const key = checkoutStorageKey("owner");
let onSuccess, onError;
function Harness({ userId = "owner", checkoutInput = input, onCreateError = () => {} }) {
  const checkout = useCheckout({ userId, token: "token", onSuccess, onError });
  return <div><span>{checkout.active?.status || "IDLE"}</span>
    <button onClick={() => checkout.create(checkoutInput).catch(onCreateError)}>Create</button>
    <button onClick={() => checkout.approve().catch(() => {})}>Approve</button>
    <button onClick={checkout.refresh}>Refresh</button>
    <button onClick={checkout.reset}>Reset</button></div>;
}
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  Object.defineProperty(window, "crypto", { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(42) } });
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
