import axios from "axios";
import { setError, shippingAddressAdd, orderCreated, clearOrder, setLoading } from "../slices/order";

export const setShippingAdress = (data) => (dispatch) => {
  dispatch(shippingAddressAdd(data));
};

export const getShippingAddressError = (value) => (dispatch) => {
  dispatch(setError(value));
};

export const createOrder = (order) => async (dispatch, getState) => {
  dispatch(setLoading(true));
  const {
    order: { shippingAddress },
    user: { userInfo },
  } = getState();

  const prepareOrder = { ...order, shippingAddress };
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        authorization: userInfo?.token ? `Bearer ${userInfo.token}` : undefined,
      },
    };
    const { data } = await axios.post("/api/orders", prepareOrder, config);
    dispatch(orderCreated(data));
    return data;
  } catch (error) {
    dispatch(
      setError(
        error.response?.data?.message || error.response?.data || error.message ||
          "An unexpected error has occurred. Please try again later"
      )
    );
    throw error;
  }
};

export const resetOrder = () => (dispatch) => dispatch(clearOrder());
