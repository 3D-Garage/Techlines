import { useEffect } from "react";
import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import PAYPAL_CLIENT_ID from "../client_id";
import { Box, useColorModeValue as mode } from "@chakra-ui/react";
// This values are the props in the UI
const currency = "HUF";
const style = { layout: "vertical", color: "gold" };

const ButtonWrapper = ({
  currency,
  showSpinner,
  total,
  onPaymentSuccess,
  onPaymentError,
  cart,
  shippingPrice,
  token,
}) => {
  const [{ options, isPending }, dispatch] = usePayPalScriptReducer();
  useEffect(() => {
    dispatch({
      type: "resetOptions",
      value: {
        ...options,
        currency: currency,
      },
    });
  }, [currency, showSpinner]);

  return (
    <>
      {showSpinner && isPending && <div className="spinner" />}
      <PayPalButtons
        style={style}
        forceReRender={[Math.round(total()), "HUF"]}
        fundingSource={undefined}
        createOrder={async () => {
          try {
            const headers = { "Content-Type": "application/json" };
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers,
              body: JSON.stringify({
                items: cart.map((i) => ({ productId: i.id, qty: i.qty })),
                shippingPrice: Math.round(shippingPrice),
              }),
            });
            const data = await res.json();
            console.log("PayPal create-order status", res.status, data);
            if (!res.ok) throw new Error(data?.message || "Failed to create PayPal order");
            console.log("PayPal order created", data?.id);
            return data.id;
          } catch (e) {
            console.error("PayPal create-order error", e);
            onPaymentError(e);
          }
        }}
        onApprove={async function (data) {
          try {
            console.log("PayPal onApprove orderID", data?.orderID);
            const headers = { "Content-Type": "application/json" };
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch("/api/paypal/capture-order", {
              method: "POST",
              headers,
              body: JSON.stringify({ orderID: data.orderID }),
            });
            const capture = await res.json();
            console.log("PayPal capture status", res.status, capture);
            if (!res.ok) throw new Error(capture?.message || "Failed to capture PayPal order");
            onPaymentSuccess(capture);
          } catch (e) {
            console.error("PayPal capture error", e);
            onPaymentError(e);
          }
        }}
        onError={(err) => {
          console.error("PayPal Buttons onError", err);
          onPaymentError(err);
        }}
      />
    </>
  );
};

const PayPalButton = ({ total, onPaymentSuccess, onPaymentError, cart, shippingPrice, token }) => {
  return (
    <Box
      border="1px solid"
      borderColor={mode("transparent", "rgba(255,255,255,0.6)")}
      borderRadius="md"
      overflow="hidden"
      p={2}
      bg={mode("transparent", "white")}
    >
      <PayPalScriptProvider
        options={{
          "client-id": PAYPAL_CLIENT_ID,
          currency: "HUF",
          components: "buttons",
        }}
      >
        <ButtonWrapper
          currency={currency}
          showSpinner={false}
          total={total}
          onPaymentSuccess={onPaymentSuccess}
          onPaymentError={onPaymentError}
          cart={cart}
          shippingPrice={shippingPrice}
          token={token}
        />
      </PayPalScriptProvider>
    </Box>
  );
};

export default PayPalButton;
