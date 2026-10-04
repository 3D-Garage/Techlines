import "@testing-library/jest-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CustomOrderScreen from "../CustomOrderScreen";
import AdminCustomOrderScreen from "../AdminCustomOrderScreen";
import AdminCustomOrdersScreen from "../AdminCustomOrdersScreen";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));

const config = { maxFileSizeBytes: 1024, supportedExtensions: [".stl", ".obj", ".step", ".stp"], fileRetentionDays: 30 };
const order = {
  _id: "order-123", customerName: "Teszt Elek", customerEmail: "elek@example.com", customerPhone: "+36 30 123 4567",
  description: "<img src=x onerror=alert(1)>\nAlkatrész", status: "new", adminNotes: "",
  createdAt: "2026-09-27T12:00:00Z", updatedAt: "2026-09-27T12:00:00Z", notification: { status: "failed" },
};

const renderCustomer = () => render(<ChakraProvider><CustomOrderScreen /></ChakraProvider>);
const renderAdmin = (userInfo = { isAdmin: true, token: "admin-token" }, list = false) => {
  const store = configureStore({ reducer: { user: (state = { userInfo }) => state } });
  return render(<Provider store={store}><ChakraProvider><MemoryRouter initialEntries={[list ? "/admin/custom-orders" : "/admin/custom-orders/order-123"]}>
    <Routes>
      <Route path="/admin/custom-orders" element={<AdminCustomOrdersScreen />} />
      <Route path="/admin/custom-orders/:id" element={<AdminCustomOrderScreen />} />
      <Route path="/login" element={<div>Login required</div>} />
    </Routes>
  </MemoryRouter></ChakraProvider></Provider>);
};
const fillContact = () => {
  fireEvent.change(screen.getByLabelText(/^Név/), { target: { value: " Teszt Elek " } });
  fireEvent.change(screen.getByLabelText(/^E-mail-cím/), { target: { value: "elek@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Telefonszám/), { target: { value: "+36 30 123 4567" } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Kérés elküldése" }));

beforeAll(() => {
  window.matchMedia = (query) => ({ matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() });
});

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: config });
  axios.post.mockResolvedValue({ data: { _id: "order-123", status: "new" } });
});

test("requires contact information and a description or model before posting", async () => {
  renderCustomer();
  submit();
  expect(await screen.findByText("Add meg a neved.")).toBeInTheDocument();
  expect(screen.getByText("Adj meg egy érvényes e-mail-címet.")).toBeInTheDocument();
  expect(screen.getByText("Adj meg egy érvényes telefonszámot (7–15 számjegy).")).toBeInTheDocument();
  expect(screen.getByText("Írd le az elképzelésed, vagy csatolj egy modellfájlt.")).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
});

test("submits a text-only request as multipart and shows the stored ID", async () => {
  renderCustomer();
  fillContact();
  fireEvent.change(screen.getByLabelText("Projekt leírása"), { target: { value: " Egy alkatrész " } });
  submit();
  expect(await screen.findByText("order-123")).toBeInTheDocument();
  const [url, body] = axios.post.mock.calls[0];
  expect(url).toBe("/api/custom-orders");
  expect(body.get("customerName")).toBe("Teszt Elek");
  expect(body.get("description")).toBe("Egy alkatrész");
  expect(body.has("modelFile")).toBe(false);
});

test("supports a file-only request with no description", async () => {
  renderCustomer();
  fillContact();
  const input = screen.getByLabelText("3D modellfájl");
  await waitFor(() => expect(input).toBeEnabled());
  const model = new File(["solid model\nendsolid model"], "model.STL", { type: "application/octet-stream" });
  fireEvent.change(input, { target: { files: [model] } });
  submit();
  expect(await screen.findByText("order-123")).toBeInTheDocument();
  expect(axios.post.mock.calls[0][1].get("modelFile").name).toBe("model.STL");
  expect(axios.post.mock.calls[0][1].has("description")).toBe(false);
});

test("displays the configured file retention period before uploading", async () => {
  axios.get.mockResolvedValue({ data: { ...config, fileRetentionDays: 14 } });
  renderCustomer();
  expect(await screen.findByText(/A feltöltött modellfájlt 14 napig őrizzük meg, majd automatikusan töröljük/)).toBeInTheDocument();
});

test("accepts legacy upload configuration without promising an unreported retention period", async () => {
  axios.get.mockResolvedValue({ data: { maxFileSizeBytes: config.maxFileSizeBytes, supportedExtensions: config.supportedExtensions } });
  renderCustomer();
  fillContact();
  const input = screen.getByLabelText("3D modellfájl");
  await waitFor(() => expect(input).toBeEnabled());
  expect(screen.queryByText(/A feltöltési beállítások nem tölthetők be/)).not.toBeInTheDocument();
  expect(screen.queryByText(/napig őrizzük meg/)).not.toBeInTheDocument();
  fireEvent.change(input, { target: { files: [new File(["x".repeat(config.maxFileSizeBytes + 1)], "model.stl")] } });
  submit();
  expect(await screen.findByText(/A fájl legfeljebb/)).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(["solid model\nendsolid model"], "model.stl")] } });
  submit();
  expect(await screen.findByText("order-123")).toBeInTheDocument();
  expect(axios.post.mock.calls[0][1].get("modelFile").name).toBe("model.stl");
});

test.each([
  ["missing size limit", { supportedExtensions: config.supportedExtensions }],
  ["zero size limit", { ...config, maxFileSizeBytes: 0 }],
  ["negative size limit", { ...config, maxFileSizeBytes: -1 }],
  ["non-numeric size limit", { ...config, maxFileSizeBytes: "1024" }],
  ["non-array extensions", { ...config, supportedExtensions: ".stl" }],
  ["null retention", { ...config, fileRetentionDays: null }],
  ["zero retention", { ...config, fileRetentionDays: 0 }],
  ["non-numeric retention", { ...config, fileRetentionDays: "30" }],
])("still disables uploads for malformed configuration: %s", async (_label, data) => {
  axios.get.mockResolvedValue({ data });
  renderCustomer();
  expect(await screen.findByText(/A feltöltési beállítások nem tölthetők be/)).toBeInTheDocument();
  expect(screen.getByLabelText("3D modellfájl")).toBeDisabled();
});

test("keeps request details after storage is full and allows retrying without the file", async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 503, data: { message: "A feltöltési tárhely megtelt. Fájl nélkül is elküldheted a kérésed." } } });
  renderCustomer();
  fillContact();
  fireEvent.change(screen.getByLabelText("Projekt leírása"), { target: { value: "Alkatrész" } });
  const input = screen.getByLabelText("3D modellfájl");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { files: [new File(["solid model\nendsolid model"], "model.stl")] } });
  submit();
  expect(await screen.findByText(/A feltöltési tárhely megtelt/)).toBeInTheDocument();
  expect(screen.getByLabelText("Projekt leírása")).toHaveValue("Alkatrész");
  fireEvent.click(screen.getByRole("button", { name: "Csatolmány eltávolítása" }));
  submit();
  expect(await screen.findByText("order-123")).toBeInTheDocument();
  expect(axios.post.mock.calls[1][1].has("modelFile")).toBe(false);
});

test("rejects unsupported and oversized attachments using configured limits", async () => {
  renderCustomer();
  fillContact();
  const input = screen.getByLabelText("3D modellfájl");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { files: [new File(["run"], "malware.exe")] } });
  submit();
  expect(await screen.findByText(/Nem támogatott fájltípus/)).toBeInTheDocument();
  fireEvent.change(input, { target: { files: [new File(["x".repeat(1025)], "model.obj")] } });
  submit();
  expect(await screen.findByText(/A fájl legfeljebb/)).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
});

test("keeps submitted details after server validation errors", async () => {
  axios.post.mockRejectedValue({ response: { status: 400, data: { message: "Ellenőrizd az adatokat.", errors: { description: "Túl hosszú leírás." } } } });
  renderCustomer();
  fillContact();
  fireEvent.change(screen.getByLabelText("Projekt leírása"), { target: { value: "Alkatrész" } });
  submit();
  expect(await screen.findByText("Ellenőrizd az adatokat.")).toBeInTheDocument();
  expect(screen.getByText("Túl hosszú leírás.")).toBeInTheDocument();
  expect(screen.getByLabelText("Projekt leírása")).toHaveValue("Alkatrész");
  expect(screen.getByRole("button", { name: "Kérés elküldése" })).toBeEnabled();
});

test("locks the form against duplicate submissions while a request is pending", async () => {
  let finishRequest;
  axios.post.mockReturnValue(new Promise((resolve) => { finishRequest = resolve; }));
  renderCustomer();
  fillContact();
  const description = screen.getByLabelText("Projekt leírása");
  fireEvent.change(description, { target: { value: "Alkatrész" } });
  const form = description.closest("form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(description).toBeDisabled();
  finishRequest({ data: { _id: "order-123", status: "new" } });
  expect(await screen.findByText("order-123")).toBeInTheDocument();
});

test("continues to allow text requests if upload configuration fails", async () => {
  axios.get.mockRejectedValue(new Error("Network unavailable"));
  renderCustomer();
  expect(await screen.findByText(/A feltöltési beállítások nem tölthetők be/)).toBeInTheDocument();
  expect(screen.getByLabelText("3D modellfájl")).toBeDisabled();
  fillContact();
  fireEvent.change(screen.getByLabelText("Projekt leírása"), { target: { value: "Alkatrész" } });
  submit();
  expect(await screen.findByText("order-123")).toBeInTheDocument();
});

test.each([
  ["current", config],
  ["legacy", { maxFileSizeBytes: config.maxFileSizeBytes, supportedExtensions: config.supportedExtensions }],
])("recovers from a failed configuration load with %s settings and preserves form values", async (_label, data) => {
  axios.get.mockRejectedValueOnce(new Error("Temporary network failure")).mockResolvedValueOnce({ data });
  renderCustomer();
  expect(await screen.findByText(/A feltöltési beállítások nem tölthetők be/)).toBeInTheDocument();
  const input = screen.getByLabelText("3D modellfájl");
  expect(input).toBeDisabled();
  fillContact();
  fireEvent.change(screen.getByLabelText("Projekt leírása"), { target: { value: "Megőrzendő leírás" } });
  fireEvent.click(screen.getByRole("button", { name: "Beállítások újratöltése" }));
  await waitFor(() => expect(input).toBeEnabled());
  expect(screen.queryByText(/A feltöltési beállítások nem tölthetők be/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^Név/)).toHaveValue(" Teszt Elek ");
  expect(screen.getByLabelText("Projekt leírása")).toHaveValue("Megőrzendő leírás");
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.get.mock.calls.every(([url]) => url === "/api/custom-orders/config")).toBe(true);
  fireEvent.change(input, { target: { files: [new File(["solid model\nendsolid model"], "model.stl")] } });
  submit();
  expect(await screen.findByText("order-123")).toBeInTheDocument();
  const body = axios.post.mock.calls[0][1];
  expect(body.get("customerName")).toBe("Teszt Elek");
  expect(body.get("description")).toBe("Megőrzendő leírás");
  expect(body.get("modelFile").name).toBe("model.stl");
});

test.each([null, { isAdmin: false, token: "customer-token" }])("blocks non-admin detail access without making requests (%j)", (userInfo) => {
  renderAdmin(userInfo);
  expect(screen.getByText(userInfo ? "A megtekintéshez adminisztrátori jogosultság szükséges." : "Login required")).toBeInTheDocument();
  expect(axios.get).not.toHaveBeenCalled();
});

test("renders untrusted text safely and saves status plus internal notes with authorization", async () => {
  axios.get.mockResolvedValue({ data: order });
  axios.patch.mockResolvedValue({ data: { ...order, status: "quoted", adminNotes: "Ajánlat elküldve." } });
  const { container } = renderAdmin();
  expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(/Az e-mail-értesítés küldése nem sikerült/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Állapot"), { target: { value: "quoted" } });
  fireEvent.change(screen.getByLabelText(/Belső megjegyzés/), { target: { value: "Ajánlat elküldve." } });
  fireEvent.click(screen.getByRole("button", { name: "Módosítások mentése" }));
  await waitFor(() => expect(axios.patch).toHaveBeenCalledWith("/api/custom-orders/order-123/status", { status: "quoted", adminNotes: "Ajánlat elküldve." }, { headers: { Authorization: "Bearer admin-token" } }));
  expect(await screen.findByText("Az állapot és a belső megjegyzés mentve.")).toBeInTheDocument();
});

test("filters the admin table with authenticated requests", async () => {
  axios.get.mockResolvedValue({ data: { orders: [order], total: 1, page: 1, pages: 1 } });
  renderAdmin(undefined, true);
  expect(await screen.findByText("Teszt Elek")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Állapot szerinti szűrés"), { target: { value: "printing" } });
  await waitFor(() => expect(axios.get).toHaveBeenLastCalledWith("/api/custom-orders", expect.objectContaining({ headers: { Authorization: "Bearer admin-token" }, params: { page: 1, status: "printing" } })));
  expect(await screen.findByRole("link", { name: "Részletek" })).toHaveAttribute("href", "/admin/custom-orders/order-123");
});

test("returns to the last available page when refreshed results shrink", async () => {
  axios.get.mockResolvedValueOnce({ data: { orders: [order], total: 2, page: 1, pages: 2 } })
    .mockResolvedValueOnce({ data: { orders: [order], total: 2, page: 2, pages: 2 } })
    .mockResolvedValueOnce({ data: { orders: [], total: 1, page: 2, pages: 1 } })
    .mockResolvedValueOnce({ data: { orders: [order], total: 1, page: 1, pages: 1 } });
  renderAdmin(undefined, true);
  fireEvent.click(await screen.findByRole("button", { name: "Következő" }));
  expect(await screen.findByText("2. / 2. oldal")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Frissítés" }));
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(4));
  expect(axios.get).toHaveBeenLastCalledWith("/api/custom-orders", expect.objectContaining({ params: { page: 1 } }));
  expect(await screen.findByText("Teszt Elek")).toBeInTheDocument();
  expect(screen.getByText("Összesen 1 kérés")).toBeInTheDocument();
});

test("downloads attached models with the administrator bearer token", async () => {
  axios.get.mockResolvedValueOnce({ data: { ...order, modelFile: { originalName: "model.stl", extension: ".stl", size: 123, mimeType: "model/stl" } } })
    .mockResolvedValueOnce({ data: new Blob(["model data"]) });
  URL.createObjectURL = jest.fn().mockReturnValue("blob:test-model");
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  renderAdmin();
  fireEvent.click(await screen.findByRole("button", { name: "Modellfájl letöltése" }));
  await waitFor(() => expect(axios.get).toHaveBeenLastCalledWith("/api/custom-orders/order-123/file", { headers: { Authorization: "Bearer admin-token" }, responseType: "blob" }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  click.mockRestore();
});

test("retains attachment metadata but disables expired model downloads", async () => {
  const expiresAt = "2026-09-27T12:00:00Z";
  axios.get.mockResolvedValue({ data: { ...order, modelFile: { originalName: "old-model.stl", extension: ".stl", size: 123, mimeType: "model/stl", expiresAt, expired: true } } });
  renderAdmin();
  expect(await screen.findByText("old-model.stl")).toBeInTheDocument();
  expect(screen.getByText(`Megőrzési határidő: ${new Date(expiresAt).toLocaleString("hu-HU")}`)).toBeInTheDocument();
  expect(screen.getByText(/A modellfájl megőrzési ideje lejárt/)).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Modellfájl letöltése" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test.each([
  ["missing", JSON.stringify({ code: "CUSTOM_ORDER_FILE_MISSING" })],
  ["expired", JSON.stringify({ code: "CUSTOM_ORDER_FILE_EXPIRED" })],
  ["legacy", "Expired"],
])("disables stale downloads after a %s 410 response without assuming why the file is unavailable", async (_reason, body) => {
  axios.get.mockResolvedValueOnce({ data: { ...order, modelFile: { originalName: "model.stl", extension: ".stl", size: 123, mimeType: "model/stl", expired: false } } })
    .mockRejectedValueOnce({ response: { status: 410, data: new Blob([body]) } });
  renderAdmin();
  const download = await screen.findByRole("button", { name: "Modellfájl letöltése" });
  fireEvent.change(screen.getByLabelText(/Belső megjegyzés/), { target: { value: "Még nem mentett jegyzet" } });
  fireEvent.click(download);
  expect(await screen.findByText(/A modellfájl már nem érhető el/)).toBeInTheDocument();
  expect(screen.queryByText(/A modellfájl megőrzési ideje lejárt/)).not.toBeInTheDocument();
  expect(download).toBeDisabled();
  expect(screen.getByLabelText(/Belső megjegyzés/)).toHaveValue("Még nem mentett jegyzet");
  fireEvent.click(download);
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test("keeps a deleted attachment unavailable after the retention period is increased", async () => {
  axios.get.mockResolvedValue({ data: { ...order, modelFile: { originalName: "deleted-model.stl", extension: ".stl", size: 123, mimeType: "model/stl", expiresAt: null, expired: false, available: false, missing: true } } });
  renderAdmin();
  expect(await screen.findByText("deleted-model.stl")).toBeInTheDocument();
  expect(screen.getByText(/A modellfájl már nem érhető el/)).toBeInTheDocument();
  expect(screen.queryByText(/Megőrzési határidő:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/A modellfájl megőrzési ideje lejárt/)).not.toBeInTheDocument();
  const download = screen.getByRole("button", { name: "Modellfájl letöltése" });
  expect(download).toBeDisabled();
  fireEvent.click(download);
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test.each([false, true])("marks missing attachments unavailable in the admin table even when expired is %s", async (expired) => {
  axios.get.mockResolvedValue({ data: { orders: [{ ...order, modelFile: { available: false, missing: true, expired } }], total: 1, page: 1, pages: 1 } });
  renderAdmin(undefined, true);
  expect(await screen.findByText("Nem elérhető")).toBeInTheDocument();
  expect(screen.queryByText("Csatolva")).not.toBeInTheDocument();
});

test("marks expired attachments in the admin table", async () => {
  axios.get.mockResolvedValue({ data: { orders: [{ ...order, modelFile: { expired: true } }], total: 1, page: 1, pages: 1 } });
  renderAdmin(undefined, true);
  expect(await screen.findByText("Lejárt")).toBeInTheDocument();
  expect(screen.queryByText("Csatolva")).not.toBeInTheDocument();
});
