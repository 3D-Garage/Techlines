// Cart actions: add/remove items and handle errors
import axios from "axios";
import {
  setLoading,
  setError,
  cartItemAdd,
  cartItemRemoval,
} from "../slices/cart";

// Fetch product by id and add to cart with selected qty
export const addCartItem = (id, qty) => async (dispatch) => {
  dispatch(setLoading(true));
  try {
    const { data } = await axios.get(`/api/products/${id}`);
    const itemToAdd = {
      id: data._id,
      name: data.name,
      image: data.image,
      price: data.price,
      stock: data.stock,
      qty,
    };
    dispatch(cartItemAdd(itemToAdd));
  } catch (error) {
    dispatch(
      setError(
        error.response && error.response.data.message
          ? error.response.data.message
          : error.message
          ? error.message
          : "An unexpected error has occured. Please try again later"
      )
    );
  }
};

// Remove item from cart by product id
export const removeCartitem = (id) => async (dispatch) => {
  dispatch(setLoading(true));
  dispatch(cartItemRemoval(id));
};
