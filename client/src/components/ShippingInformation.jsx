import { Box, Flex, FormControl, FormLabel, Heading, Input, Radio, RadioGroup, Stack, Text, Tooltip } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { setExpress } from "../redux/actions/cartAction";
import { setShippingAdress, getShippingAddressError } from "../redux/actions/orderAction";

const ShippingInformation = () => {
  const dispatch = useDispatch();
  const [address, setAddress] = useState({ address: "", postalCode: "", city: "", country: "" });

  useEffect(() => {
    const complete = Object.values(address).every((value) => value.trim().length >= 2);
    dispatch(getShippingAddressError(complete ? null : "Please complete the shipping address."));
    if (complete) dispatch(setShippingAdress(address));
  }, [address, dispatch]);

  const update = (event) => setAddress((current) => ({ ...current, [event.target.name]: event.target.value }));

  return (
    <Stack spacing="8">
      <FormControl isRequired>
        <FormLabel>Street address</FormLabel>
        <Input name="address" value={address.address} onChange={update} placeholder="Street and house number" focusBorderColor="purple.500" />
      </FormControl>
      <Flex gap="4" direction={{ base: "column", sm: "row" }}>
        <FormControl isRequired>
          <FormLabel>Postal code</FormLabel>
          <Input name="postalCode" value={address.postalCode} onChange={update} placeholder="Postal code" focusBorderColor="purple.500" />
        </FormControl>
        <FormControl isRequired>
          <FormLabel>City</FormLabel>
          <Input name="city" value={address.city} onChange={update} placeholder="City" focusBorderColor="purple.500" />
        </FormControl>
      </Flex>
      <FormControl isRequired>
        <FormLabel>Country</FormLabel>
        <Input name="country" value={address.country} onChange={update} placeholder="Country" focusBorderColor="purple.500" />
      </FormControl>
      <Box>
        <Heading fontSize="2xl" mb="5">Shipping Method</Heading>
        <RadioGroup defaultValue="false" onChange={(value) => dispatch(setExpress(value))}>
          <Stack direction={{ base: "column", md: "row" }} spacing="8">
            <Radio value="true" colorScheme="purple">
              <Text fontWeight="bold">Express 3,990 Ft</Text>
              <Text fontSize="sm">Dispatched within 24 hours.</Text>
            </Radio>
            <Radio value="false" colorScheme="purple">
              <Tooltip label="Free shipping for orders over 10,000 Ft">
                <Box>
                  <Text fontWeight="bold">Standard 1,490 Ft</Text>
                  <Text fontSize="sm">Dispatched in 2–3 business days.</Text>
                </Box>
              </Tooltip>
            </Radio>
          </Stack>
        </RadioGroup>
      </Box>
    </Stack>
  );
};

export default ShippingInformation;
