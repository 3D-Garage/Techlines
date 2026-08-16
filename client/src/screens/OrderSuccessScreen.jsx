import { Alert, AlertIcon, AlertTitle, Button, Stack, Text, Wrap } from "@chakra-ui/react";
import { Link as ReactLink } from "react-router-dom";

const OrderSuccessScreen = () => (
  <Wrap justify="center" direction="column" align="center" minH="100vh" px="4">
    <Alert status="success" variant="subtle" flexDirection="column" alignItems="center" textAlign="center" rounded="xl" maxW="xl" py="12">
      <AlertIcon boxSize="55px" />
      <AlertTitle pt="4" fontSize="2xl">Payment successful!</AlertTitle>
      <Text mt="2">Your order has been saved and is now being processed.</Text>
      <Stack mt="8" minW="220px">
        <Button colorScheme="purple" as={ReactLink} to="/your-orders">View your orders</Button>
        <Button colorScheme="purple" variant="outline" as={ReactLink} to="/products">Continue shopping</Button>
      </Stack>
    </Alert>
  </Wrap>
);

export default OrderSuccessScreen;
