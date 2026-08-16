import { createSlice } from "@reduxjs/toolkit";

const adminSlice = createSlice({
  name: "admin",
  initialState: { loading: false, error: null, users: [], orders: [] },
  reducers: {
    setAdminLoading: (state) => { state.loading = true; state.error = null; },
    setAdminError: (state, { payload }) => { state.loading = false; state.error = payload; },
    setUsers: (state, { payload }) => { state.loading = false; state.users = payload; },
    removeUser: (state, { payload }) => { state.loading = false; state.users = state.users.filter((user) => user._id !== payload); },
    setOrders: (state, { payload }) => { state.loading = false; state.orders = payload; },
    removeOrder: (state, { payload }) => { state.loading = false; state.orders = state.orders.filter((order) => order._id !== payload); },
    replaceOrder: (state, { payload }) => { state.loading = false; state.orders = state.orders.map((order) => order._id === payload._id ? payload : order); },
  },
});

export const { setAdminLoading, setAdminError, setUsers, removeUser, setOrders, removeOrder, replaceOrder } = adminSlice.actions;
export default adminSlice.reducer;
