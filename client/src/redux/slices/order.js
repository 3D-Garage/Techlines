import { createSlice } from "@reduxjs/toolkit";
import { userLogin, userLogout } from "./user";

export const initialState = {
  loading: false,
  error: null,
  shippingAddress: null,
  recipientPhone: "",
  foxpostLocker: null,
  foxpostListReady: false,
  orderInfo: null,
};

export const orderSlice = createSlice({
  name: "order",
  initialState,
  reducers: {
    setFoxpostDetails: (state, { payload }) => {
      Object.assign(state, payload);
    },
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
      state.recipientPhone = "";
      state.foxpostLocker = null;
      state.foxpostListReady = false;
      state.orderInfo = null;
      state.error = null;
      state.loading = false;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(userLogout, () => ({ ...initialState }));
    builder.addCase(userLogin, () => ({ ...initialState }));
  },
});

export const { setError, setLoading, shippingAddressAdd, orderCreated, clearOrder, setFoxpostDetails } = orderSlice.actions;
export default orderSlice.reducer;

export const orderSelector = (state) => state.order;
