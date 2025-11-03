import { useEffect } from "react";
import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import PAYPAL_CLIENT_ID from "../client_id";
// This values are the props in the UI
const currency = "HUF";
const style = { layout: "vertical", color: "gold" };

const ButtonWrapper = ({ currency, showSpinner, total, onPaymentSuccess, onPaymentError }) => {
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
        forceReRender={([total()], style)}
        fundingSource={undefined}
        createOrder={(data, actions) => {
          return actions.order.create({
            purchase_units: [
              {
                amount: {
                  currency_code: currency,
                  value: Math.round(total()),
                },
              },
            ],
          });
        }}
        onApprove={function (data, actions) {
          return actions.order.capture().then((details) => {
            onPaymentSuccess("Order succes.");
          });
        }}
        onError={(err) => {
          onPaymentError(err);
        }}
      />
    </>
  );
};

const PayPalButton = ({ total, onPaymentSuccess, onPaymentError }) => {
  return (
    <div style={{ background: "blue !important" }}>
      <PayPalScriptProvider
        options={{
          "client-id": PAYPAL_CLIENT_ID,
          currency: "HUF",
        }}
      >
        <ButtonWrapper
          currency={currency}
          showSpinner={false}
          total={total}
          onPaymentSuccess={onPaymentSuccess}
          onPaymentError={onPaymentError}
        />
      </PayPalScriptProvider>
    </div>
  );
};

export default PayPalButton;
