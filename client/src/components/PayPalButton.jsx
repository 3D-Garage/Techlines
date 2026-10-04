import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertIcon, Box, Spinner, useColorModeValue as mode } from "@chakra-ui/react";
// This values are the props in the UI
const style = { layout: "vertical", color: "gold" };

const ButtonWrapper = ({
  showSpinner,
  total,
  onPaymentError,
  cart,
  shippingMethod,
  disabled,
  shippingAddress,
  checkout,
}) => {
  const [{ isPending }] = usePayPalScriptReducer();
  // The SDK keeps callbacks from its initial render. Read the latest form values.
  const values = useRef();
  values.current = { cart, shippingMethod, shippingAddress, checkout };
  const numericTotal = Number(typeof total === "function" ? total() : total || 0);

  return (
    <>
      {showSpinner && isPending && <div className="spinner" />}
      <PayPalButtons
        disabled={disabled}
        style={style}
        forceReRender={[Math.round(numericTotal), "HUF"]}
        fundingSource={undefined}
        createOrder={async () => {
          try {
            const current = values.current;
            return await current.checkout.create({
                items: current.cart.map((i) => ({ productId: i.id, qty: i.qty })),
                shippingMethod: current.shippingMethod,
                shippingAddress: current.shippingAddress,
            });
          } catch (e) {
            onPaymentError(e);
            throw e;
          }
        }}
        onApprove={async function () {
          try {
            await values.current.checkout.approve();
          } catch (e) {
            onPaymentError(e);
          }
        }}
        onError={(err) => {
          onPaymentError(err);
        }}
      />
    </>
  );
};

const PayPalButton = ({ total, onPaymentError, cart, shippingMethod, shippingAddress, disabled, checkout }) => {
  const [clientId, setClientId] = useState("");
  const [loadError, setLoadError] = useState("");
  const borderColor = mode("gray.200", "gray.700");
  const background = mode("white", "transparent");

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

  if (loadError)
    return (
      <Alert status="error" rounded="md">
        <AlertIcon />
        {loadError}
      </Alert>
    );
  if (!clientId) return <Spinner color="purple.500" alignSelf="center" />;

  return (
    <Box
      border="1px solid"
      borderColor={borderColor}
      borderRadius="md"
      overflow="hidden"
      p={2}
      bg={background}
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
          onPaymentError={onPaymentError}
          cart={cart}
          shippingMethod={shippingMethod}
          shippingAddress={shippingAddress}
          checkout={checkout}
          disabled={disabled}
        />
      </PayPalScriptProvider>
    </Box>
  );
};

export default PayPalButton;
