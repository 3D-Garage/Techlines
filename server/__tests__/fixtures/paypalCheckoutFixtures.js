export const CHECKOUT_ADDRESS = Object.freeze({
  address: "1 Sandbox Way",
  city: "Budapest",
  postalCode: "1051",
  country: "HU",
});

export const money = (value, currency = "HUF") => ({
  currency_code: currency,
  value: `${value}.00`,
});

export const approvedPayPalOrder = ({
  id,
  referenceId,
  customId,
  amount,
  currency = "HUF",
}) => ({
  id,
  status: "APPROVED",
  purchase_units: [
    {
      reference_id: referenceId,
      custom_id: customId,
      amount: money(amount, currency),
    },
  ],
});

export const completedPayPalOrder = ({
  id,
  referenceId,
  customId,
  amount,
  currency = "HUF",
  captureId = `CAPTURE-${id}`,
  captureStatus = "COMPLETED",
  captureAmount = amount,
  captureCurrency = currency,
  payerId = "SANDBOX-PAYER",
  createTime = "2026-08-27T12:34:56Z",
}) => ({
  id,
  status: "COMPLETED",
  payer: {
    payer_id: payerId,
    email_address: "sandbox-buyer@example.test",
  },
  purchase_units: [
    {
      reference_id: referenceId,
      payments: {
        captures: [
          {
            id: captureId,
            status: captureStatus,
            amount: money(captureAmount, captureCurrency),
            create_time: createTime,
          },
        ],
      },
    },
  ],
});

export const checkoutBody = (productId, overrides = {}) => ({
  items: [{ productId: String(productId), qty: 2 }],
  shippingAddress: { ...CHECKOUT_ADDRESS },
  shippingMethod: "standard",
  ...overrides,
});
