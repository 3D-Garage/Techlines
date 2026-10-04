import "@testing-library/jest-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import FoxpostLockerPicker, { FOXPOST_WIDGET_ORIGIN } from "../FoxpostLockerPicker";
import OrderShippingDetails from "../OrderShippingDetails";
import { normalizeRecipientPhone } from "../../utils/shipping";
const locker = { place_id: "123", operator_id: "hu123", name: "FOXPOST A-BOX Test", address: "1111 Budapest, Automata utca 1." };
beforeAll(() => {
  window.matchMedia = (query) => ({ matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() });
});
test("accepts selection only from the expected origin and embedded window, using official list data", () => {
  const onSelect = jest.fn();
  render(<ChakraProvider><FoxpostLockerPicker isOpen onClose={() => {}} lockers={[locker]} onSelect={onSelect} /></ChakraProvider>);
  const source = screen.getByTitle("FOXPOST térképes és listás automataválasztó").contentWindow;
  const send = (origin, messageSource, data) => act(() => window.dispatchEvent(new MessageEvent("message", { origin, source: messageSource, data })));
  send("https://evil.example", source, JSON.stringify({ place_id: 123 }));
  send(FOXPOST_WIDGET_ORIGIN, window, JSON.stringify({ place_id: 123 }));
  expect(onSelect).not.toHaveBeenCalled();
  send(FOXPOST_WIDGET_ORIGIN, source, JSON.stringify({ place_id: 999 }));
  expect(screen.getByRole("alert")).toHaveTextContent("Más partnerpont");
  send(FOXPOST_WIDGET_ORIGIN, source, "not JSON");
  expect(screen.getByRole("alert")).toHaveTextContent("érvénytelen adatot");
  send(FOXPOST_WIDGET_ORIGIN, source, JSON.stringify({ place_id: 123, name: "Fake", address: "Fake" }));
  expect(onSelect).toHaveBeenCalledWith(locker);
});
test("widget timeout offers reload, which replaces the embedded window", () => {
  jest.useFakeTimers();
  const view = render(<ChakraProvider><FoxpostLockerPicker isOpen onClose={() => {}} lockers={[locker]} onSelect={() => {}} /></ChakraProvider>);
  const oldFrame = screen.getByTitle("FOXPOST térképes és listás automataválasztó");
  act(() => jest.advanceTimersByTime(20000));
  expect(screen.getByRole("alert")).toHaveTextContent("nem töltődött be");
  fireEvent.click(screen.getByRole("button", { name: "Választó újratöltése" }));
  expect(screen.getByTitle("FOXPOST térképes és listás automataválasztó")).not.toBe(oldFrame);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.unmount();
  jest.useRealTimers();
});
test("order details show the saved locker, phone and destination code for manual dispatch", () => {
  render(<ChakraProvider><OrderShippingDetails admin order={{ shippingMethod: "foxpost", foxpostLocker: locker, recipientPhone: "+36301234567" }} /></ChakraProvider>);
  expect(screen.getByText("FOXPOST csomagautomata")).toBeInTheDocument();
  expect(screen.getByText(locker.name)).toBeInTheDocument();
  expect(screen.getByText(locker.address)).toBeInTheDocument();
  expect(screen.getByText("Célautomata-kód: hu123")).toBeInTheDocument();
  expect(screen.getByText("Telefon: +36301234567")).toBeInTheDocument();
});
test.each([undefined, "legacy-unknown", "constructor", "toString", "__proto__"])("legacy order (%s) displays home delivery", (shippingMethod) => {
  render(<ChakraProvider><OrderShippingDetails order={{ shippingMethod, shippingAddress: { address: "Old utca 1.", city: "Budapest", postalCode: "1111", country: "HU" } }} /></ChakraProvider>);
  expect(screen.getByText("Házhoz szállítás")).toBeInTheDocument();
  expect(screen.getByText(/Old utca/)).toBeInTheDocument();
});

test.each(["20", "30", "31", "50", "51", "70"])("frontend accepts documented %s mobile prefix", (prefix) => {
  expect(normalizeRecipientPhone(`06 ${prefix} 123 4567`)).toBe(`+36${prefix}1234567`);
});

test("loaded iframe with broken internal content keeps help, reload and close available", () => {
  jest.useFakeTimers();
  const onClose = jest.fn(), onSelect = jest.fn();
  const view = render(<ChakraProvider><FoxpostLockerPicker isOpen onClose={onClose} lockers={[locker]} onSelect={onSelect} /></ChakraProvider>);
  const initialFrame = screen.getByTitle("FOXPOST térképes és listás automataválasztó");
  const initialSource = initialFrame.contentWindow;
  fireEvent.load(initialFrame);
  act(() => jest.advanceTimersByTime(20000));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText(/Ha a térkép vagy a lista nem működik/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Választó újratöltése" }));
  const replacement = screen.getByTitle("FOXPOST térképes és listás automataválasztó");
  act(() => window.dispatchEvent(new MessageEvent("message", { origin: FOXPOST_WIDGET_ORIGIN, source: initialSource, data: JSON.stringify({ place_id: 123 }) })));
  expect(onSelect).not.toHaveBeenCalled();
  expect(replacement).not.toBe(initialFrame);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
  view.unmount();
  jest.useRealTimers();
});
