import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useEffect, useState } from "react";
import { Alert, AlertIcon, Box, Spinner, useColorModeValue as mode } from "@chakra-ui/react";
// This values are the props in the UI
const style = { layout: "vertical", color: "gold" };

const ButtonWrapper = ({
  showSpinner,
  total,
  onPaymentSuccess,
  onPaymentError,
  cart,
  shippingPrice,
  token,
  disabled,
}) => {
  const [{ isPending }] = usePayPalScriptReducer();

  return (
    <>
      {showSpinner && isPending && <div className="spinner" />}
      <PayPalButtons
        disabled={disabled}
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

const PayPalButton = ({ total, onPaymentSuccess, onPaymentError, cart, shippingPrice, token, disabled }) => {
  const [clientId, setClientId] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const loadClientId = async () => {
      try {
        const response = await fetch("/api/paypal/client-id");
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || "PayPal is unavailable.");
        setClientId(data.clientId);
      } catch (error) {
        setLoadError(error.message);
      }
    };
    loadClientId();
  }, []);

  if (loadError) return <Alert status="error" rounded="md"><AlertIcon />{loadError}</Alert>;
  if (!clientId) return <Spinner color="purple.500" alignSelf="center" />;

  return (
    <Box
      border="1px solid"
      borderColor={mode("gray.200", "gray.700")}
      borderRadius="md"
      overflow="hidden"
      p={2}
      bg={mode("white", "transparent")}
    >
      <PayPalScriptProvider
        options={{
          "client-id": clientId,
          currency: "HUF",
          components: "buttons",
        }}
      >
        <ButtonWrapper
          showSpinner={false}
          total={total}
          onPaymentSuccess={onPaymentSuccess}
          onPaymentError={onPaymentError}
          cart={cart}
          shippingPrice={shippingPrice}
          token={token}
          disabled={disabled}
        />
      </PayPalScriptProvider>
    </Box>
  );
};

export default PayPalButton;
