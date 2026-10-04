import cartReducer, { removePurchasedItems } from "../cart";

beforeEach(() => localStorage.clear());

test("completion removes only purchased quantities and retains other products in storage", () => {
  const state = { cart: [{ id: "a", qty: "5", price: 100 }, { id: "b", qty: 2, price: 200 }], expressShipping: true, subtotal: 900 };
  const result = cartReducer(state, removePurchasedItems([{ product_id: "a", qty: 1 }, { product_id: "a", qty: 2 }, { product_id: "removed-from-cart", qty: 1 }]));
  expect(result.cart).toEqual([{ id: "a", qty: 2, price: 100 }, { id: "b", qty: 2, price: 200 }]);
  expect(result.subtotal).toBe(600);
  expect(JSON.parse(localStorage.getItem("cartItems"))).toEqual(result.cart);
  expect(JSON.parse(localStorage.getItem("subtotal"))).toBe(600);
  expect(result.expressShipping).toBe(true);
});

test("completion removes exhausted lines without producing negative quantities", () => {
  localStorage.setItem("cartItems", "old cart");
  localStorage.setItem("subtotal", "100");
  const result = cartReducer({ cart: [{ id: "a", qty: 1, price: 100 }], expressShipping: true, subtotal: 100 }, removePurchasedItems([{ product_id: "a", qty: 2 }]));
  expect(result.cart).toEqual([]);
  expect(result.subtotal).toBe(0);
  expect(result.expressShipping).toBe(false);
  expect(localStorage.getItem("cartItems")).toBeNull();
  expect(localStorage.getItem("subtotal")).toBeNull();
});
