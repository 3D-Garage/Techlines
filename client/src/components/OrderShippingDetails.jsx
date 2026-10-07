import { Stack, Text } from "@chakra-ui/react";
import { shippingMethodLabel } from "../utils/shipping";

export default function OrderShippingDetails({ order, admin = false }) {
  const locker = order.foxpostLocker;
  const address = order.shippingAddress;
  return <Stack spacing="1" whiteSpace="normal" minW="180px">
    <Text fontWeight="semibold">{shippingMethodLabel(order.shippingMethod)}</Text>
    {order.shippingMethod === "foxpost" && locker ? <>
      <Text>{locker.name}</Text><Text>{locker.address}</Text>
      {admin && <><Text>Célautomata-kód: {locker.operator_id}</Text><Text>Telefon: {order.recipientPhone}</Text></>}
    </> : address && <Text>{address.address}, {address.postalCode} {address.city}, {address.country}</Text>}
  </Stack>;
}
