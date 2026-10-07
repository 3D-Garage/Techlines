import "@testing-library/jest-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ShippingInformation from "../ShippingInformation";
import userReducer, { userLogin, userLogout } from "../../redux/slices/user";
import orderReducer from "../../redux/slices/order";
import cartReducer from "../../redux/slices/cart";
import { shippingDraftKey } from "../../utils/shipping";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));

const accountA = { _id: "account-a", name: "Account A", email: "a@example.com" };
const accountB = { _id: "account-b", name: "Account B", email: "b@example.com" };
const locker = { place_id: "123", name: "Account A locker", address: "1111 Budapest, Automata utca 1." };
const draftA = { shippingMethod: "foxpost", recipientPhone: "+36301234567", foxpostLocker: locker,
  shippingAddress: { address: "Account A utca 1", city: "Budapest", postalCode: "1111", country: "HU" } };
function Harness() {
  const user = useSelector((state) => state.user.userInfo);
  return user ? <ShippingInformation key={user._id} /> : null;
}
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = (query) => ({ matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ lockers: [locker] }) });
});

test("logout and login isolate shipping details while preserving each account's own draft", async () => {
  localStorage.setItem(shippingDraftKey(accountA._id), JSON.stringify(draftA));
  const store = configureStore({ reducer: { user: userReducer, order: orderReducer, cart: cartReducer } });
  store.dispatch(userLogin(accountA));
  render(<Provider store={store}><ChakraProvider><Harness /></ChakraProvider></Provider>);
  await waitFor(() => expect(store.getState().order.foxpostListReady).toBe(true));
  expect(screen.getByLabelText(/Magyar mobiltelefonszám/)).toHaveValue(draftA.recipientPhone);

  act(() => { store.dispatch(userLogout()); });
  expect(store.getState().order).toMatchObject({ shippingAddress: null, recipientPhone: "", foxpostLocker: null, foxpostListReady: false });
  act(() => { store.dispatch(userLogin(accountB)); });
  expect(screen.getByLabelText(/Street address/)).toHaveValue("");
  expect(screen.getByRole("radio", { name: /Standard 1,490/ })).toBeChecked();
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: /FOXPOST csomagautomata/ })); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(/Magyar mobiltelefonszám/)).toHaveValue("");
  expect(screen.queryByText(locker.name)).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(shippingDraftKey(accountB._id)))).toMatchObject({ recipientPhone: "", foxpostLocker: null });
  expect(JSON.parse(localStorage.getItem(shippingDraftKey(accountA._id)))).toEqual(draftA);

  act(() => { store.dispatch(userLogout()); store.dispatch(userLogin(accountA)); });
  await waitFor(() => expect(store.getState().order.foxpostListReady).toBe(true));
  expect(screen.getByLabelText(/Magyar mobiltelefonszám/)).toHaveValue(draftA.recipientPhone);
  expect(screen.getByText(locker.name)).toBeInTheDocument();
});

test("an account's empty draft never falls back to another account's Redux details", async () => {
  const draftB = { shippingMethod: "foxpost", recipientPhone: "", foxpostLocker: null,
    shippingAddress: { address: "", city: "", postalCode: "", country: "HU" } };
  localStorage.setItem(shippingDraftKey(accountB._id), JSON.stringify(draftB));
  const store = configureStore({ reducer: { user: userReducer, order: orderReducer, cart: cartReducer }, preloadedState: {
    user: { userInfo: accountB }, order: { ...draftA, foxpostListReady: true }, cart: { shippingMethod: "foxpost", cart: [] },
  } });
  render(<Provider store={store}><ChakraProvider><Harness /></ChakraProvider></Provider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Automata választása", exact: true })).toBeEnabled());
  expect(screen.getByLabelText(/Magyar mobiltelefonszám/)).toHaveValue("");
  expect(screen.queryByText(locker.name)).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(shippingDraftKey(accountB._id)))).toMatchObject({ recipientPhone: "", foxpostLocker: null });
});
