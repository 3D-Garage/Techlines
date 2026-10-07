import { createSlice } from "@reduxjs/toolkit";
import { userLogin, userLogout } from "./user";

const calcSubtotal = (cartState) => {
  let result = 0;
  cartState.map((item) => (result += item.qty * item.price));
  return Number(result);
};

export const initialState = {
  loading: false,
  error: null,
  cart: JSON.parse(localStorage.getItem("cartItems")) ?? [],
  shippingMethod: "standard",
  subtotal: localStorage.getItem("cartItems")
    ? calcSubtotal(JSON.parse(localStorage.getItem("cartItems")))
    : 0,
};

const updateLocalStorage = (cart) => {
  localStorage.setItem("cartItems", JSON.stringify(cart));
  localStorage.setItem("subtotal", JSON.stringify(calcSubtotal(cart)));
};

export const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    setLoading: (state) => {
      state.loading = true;
    },
    cartItemAdd: (state, { payload }) => {
      const existingItem = state.cart.find((item) => item.id === payload.id);
      if (existingItem) {
        state.cart = state.cart.map((item) => (item.id === existingItem.id ? payload : item));
      } else {
        state.cart = [...state.cart, payload];
      }
      state.loading = false;
      state.error = null;
      updateLocalStorage(state.cart);
      state.subtotal = calcSubtotal(state.cart);
    },
    setError: (state, { payload }) => {
      state.error = payload;
      state.loading = false;
    },
    cartItemRemoval: (state, { payload }) => {
      state.cart = [...state.cart].filter((item) => item.id !== payload);
      updateLocalStorage(state.cart);
      state.subtotal = calcSubtotal(state.cart);
      state.loading = false;
      state.error = null;
    },
    setShippingMethod: (state, { payload }) => {
      if (["standard", "express", "foxpost"].includes(payload)) state.shippingMethod = payload;
    },
    clearCart: (state) => {
      state.cart = [];
      state.subtotal = 0;
      state.shippingMethod = "standard";
      localStorage.removeItem("cartItems");
      localStorage.removeItem("subtotal");
    },
    removePurchasedItems: (state, { payload }) => {
      const purchased = new Map();
      for (const item of payload) {
        const id = String(item.product_id);
        purchased.set(id, (purchased.get(id) || 0) + Number(item.qty));
      }
      state.cart = state.cart.map((item) => ({ ...item, qty: Math.max(0, Number(item.qty) - (purchased.get(String(item.id)) || 0)) }))
        .filter((item) => item.qty > 0);
      state.subtotal = calcSubtotal(state.cart);
      if (state.cart.length) updateLocalStorage(state.cart);
      else {
        state.shippingMethod = "standard";
        localStorage.removeItem("cartItems");
        localStorage.removeItem("subtotal");
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(userLogout, (state) => { state.shippingMethod = "standard"; });
    builder.addCase(userLogin, (state) => { state.shippingMethod = "standard"; });
  },
});

export const { setLoading, setError, cartItemAdd, cartItemRemoval, setShippingMethod, clearCart, removePurchasedItems } = cartSlice.actions;
export default cartSlice.reducer;

export const cartSelector = (state) => state.cart;
