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
  useToast,
} from "@chakra-ui/react";
import { FiShoppingCart } from "react-icons/fi";
import { Link as ReactLink } from "react-router-dom";
import { StarIcon } from "@chakra-ui/icons";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { addCartItem } from "../redux/actions/cartAction";

const Rating = ({ rating, numberOfReviews }) => {
  const { iconSize, setIconsize } = useState("14px");
  return (
    <Flex>
      <HStack spacing={2}>
        <StarIcon size={iconSize} w={"14px"} color={"yellow.500"} />
        <StarIcon size={iconSize} w={"14px"} color={rating >= 2 ? "yellow.500" : "gray.300"} />
        <StarIcon size={iconSize} w={"14px"} color={rating >= 3 ? "yellow.500" : "gray.300"} />
        <StarIcon size={iconSize} w={"14px"} color={rating >= 4 ? "yellow.500" : "gray.300"} />
        <StarIcon size={iconSize} w={"14px"} color={rating >= 5 ? "yellow.500" : "gray.300"} />
      </HStack>
      <Text fontSize={"md"} fontWeight={"bold"} ml={"4px"}>
        {`${numberOfReviews} ${(numberOfReviews === 1) | (numberOfReviews === 0) ? "Review" : "Reviews"}`}
      </Text>
    </Flex>
  );
};

const ProductCard = ({ product }) => {
  const dispatch = useDispatch();
  const toast = useToast();
  const cartInfo = useSelector((state) => state.cart);
  const { cart } = cartInfo;

  const addItem = (id) => {
    if (cart.some((cartItem) => cartItem.id === id)) {
      toast({
        description: "This item is already in your cart. Go to your cart to change the amount.",
        status: "error",
        isClosable: true,
      });
    } else {
      dispatch(addCartItem(id, 1));
      toast({
        description: "Item has been added",
        status: "success",
        isClosable: true,
      });
    }
  };
  return (
    <Stack p="3" spacing="3px" minW="240px" minH={"450px"} borderWidth="1px" rounded="lg" position="relative">
      {product.productIsNew && (
        <Circle size={"10px"} position="absolute" top={2} right={2} bg={"green.300"} />
      )}
      {product.stock <= 0 && <Circle size={"10px"} position="absolute" top={2} right={2} bg={"red.300"} />}
      <Image src={product.image} alt={product.name} roundedTop={"lg"} />

      <Box flex={1} maxH={5} alignItems={"baseline"}>
        {product.stock <= 0 && (
          <Badge rounded={"full"} px={2} fontSize={"0.7em"} colorScheme="red">
            Sold Out
          </Badge>
        )}
        {product.productIsNew && (
          <Badge rounded={"full"} px={2} fontSize={"0.7em"} colorScheme="green">
            New
          </Badge>
        )}
      </Box>
      <Flex mt={1} justifyContent={"space-between"} alignContent={"center"}>
        <Link as={ReactLink} to={`/product/${product._id}`} pt={2} cursor={"pointer"}>
          <Box fontSize={"2xl"} fontWeight={"semibold"} lineHeight={"tight"}>
            {product.name}
          </Box>
        </Link>
      </Flex>
      <Flex justifyContent={"space-between"} alignContent="center">
        <Rating rating={product.rating} numberOfReviews={product.numberOfReviews} />
      </Flex>
      <Flex justify={"space-between"}>
        <Box fontSize={"md"} alignSelf={"center"}>
          {product.price + " "}
          <Box as="span" color={"gray.600"} fontSize={"md"}>
            Ft
          </Box>
        </Box>
        <Tooltip label="Add to cart" bg={"white"} placement="top" color={"gray.800"} fontSize={"1.2em"}>
          <Button
            variant={"ghost"}
            display={"flex"}
            disabled={product.stock <= 0}
            onClick={() => addItem(product._id)}
          >
            <Icon as={FiShoppingCart} h={5} w={5} alignSelf={"center"} />
          </Button>
        </Tooltip>
      </Flex>
    </Stack>
  );
};

export default ProductCard;
