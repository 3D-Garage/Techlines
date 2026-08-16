import { createSlice } from "@reduxjs/toolkit";

export const initialState = {
  loading: false,
  error: null,
  shippingAddress: null,
  orderInfo: null,
};

export const orderSlice = createSlice({
  name: "order",
  initialState,
  reducers: {
    setLoading: (state) => {
      state.loading = true;
    },
    setError: (state, { payload }) => {
      state.error = payload;
      state.loading = false;
    },
    shippingAddressAdd: (state, { payload }) => {
      state.shippingAddress = payload;
      state.loading = false;
    },
    orderCreated: (state, { payload }) => {
      state.orderInfo = payload;
      state.loading = false;
      state.error = null;
    },
    clearOrder: (state) => {
      state.shippingAddress = null;
      state.orderInfo = null;
      state.error = null;
      state.loading = false;
    },
  },
});

export const { setError, setLoading, shippingAddressAdd, orderCreated, clearOrder } = orderSlice.actions;
export default orderSlice.reducer;

export const orderSelector = (state) => state.order;
