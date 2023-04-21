import {
  Flex,
  Circle,
  Box,
  Image,
  Badge,
  useColorModeValue,
  Icon,
  Button,
  Tooltip,
  Stack,
  Link,
  HStack,
  Text,
  Center,
} from "@chakra-ui/react";
import { FiShoppingCart } from "react-icons/fi";
import { Link as ReactLink } from "react-router-dom";
import { StarIcon } from "@chakra-ui/icons";
import { useState } from "react";

const ProductCard = ({ product }) => {
  return (
    <Stack
      p="3"
      spacing="3px"
      minW="240px"
      h="450px"
      borderWidth="1px"
      rounded="lg"
      position="relative"
    >
      {product.isNew && (
        <Circle
          size={"10px"}
          position="absolute"
          top={2}
          right={2}
          bg={"green.300"}
        />
      )}
      {product.stock <= 0 && (
        <Circle
          size={"10px"}
          position="absolute"
          top={2}
          right={2}
          bg={"red.300"}
        />
      )}
      <Image src={product.image} alt={product.name} roundedTop={"lg"} />

      <Box flex={1} maxH={5} alignItems={"baseline"}>
        {product.stock <= 0 && (
          <Badge rounded={"full"} px={2} fontSize={"0.8em"} colorScheme="red">
            Sold Out
          </Badge>
        )}
        {product.isNew && (
          <Badge rounded={"full"} px={2} fontSize={"0.8em"} colorScheme="green">
            New
          </Badge>
        )}
      </Box>
      <Flex mt={1} justifyContent={"space-between"} alignContent={"center"}>
        <Link
          as={ReactLink}
          to={`/product${product._id}`}
          pt={2}
          cursor={"pointer"}
        >
          <Box fontSize={"2xl"} fontWeight={"semibold"} lineHeight={"tight"}>
            {product.name}
          </Box>
        </Link>
      </Flex>
      <Flex justify={"space-between"}>
        <Box fontSize={"2xl"}>
          <Box as="span" color={"gray.600"} fontSize={"lg"}>
            Ft
          </Box>
          {product.price.toFixed(2)}
        </Box>
        <Tooltip
          label="Add to cart"
          bg={"white"}
          placement="top"
          color={"gray.800"}
          fontSize={"1.2em"}
        >
          <Button
            variant={"ghost"}
            display={"flex"}
            disabled={product.stock <= 0}
          >
            <Icon as={FiShoppingCart} h={7} w={7} alignSelf={"center"} />
          </Button>
        </Tooltip>
      </Flex>
    </Stack>
  );
};

export default ProductCard;
