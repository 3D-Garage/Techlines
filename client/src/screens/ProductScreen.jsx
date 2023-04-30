import { useParams } from "react-router-dom";
import {
  Box,
  Image,
  Text,
  Wrap,
  Stack,
  Spinner,
  Alert,
  AlertIcon,
  AlertDescription,
  AlertTitle,
  Flex,
  Link,
  Badge,
  Heading,
  HStack,
  Button,
  SimpleGrid,
  useToast,
  ButtonGroup,
  IconButton,
  Square,
} from "@chakra-ui/react";
import { MinusIcon, StarIcon, SmallAddIcon, AddIcon } from "@chakra-ui/icons";
import { BiPackage, BiCheckShield, BiSupport } from "react-icons/bi";
import { useDispatch, useSelector } from "react-redux";
import { getProduct } from "../redux/actions/productAction";
import { addCartItem } from "../redux/actions/cartAction";
import { useEffect, useState } from "react";
import { Link as ReactLink } from "react-router-dom";
import { color } from "framer-motion";

const ProductScreen = () => {
  const [amount, setAmount] = useState(1);
  let { id } = useParams();
  const toast = useToast();
  //redux
  const dispatch = useDispatch();
  const products = useSelector((state) => state.products);
  const { loading, error, product } = products;
  const cartContent = useSelector((state) => state.cart);
  const { cart } = cartContent;

  useEffect(() => {
    dispatch(getProduct(id));
  }, [dispatch, id, cart]);

  const changeAmount = (input) => {
    if (input === "plus") {
      setAmount(amount + 1);
    }
    if (input === "minus") {
      setAmount(amount - 1);
    }
  };

  const addItem = () => {
    dispatch(addCartItem(product._id, amount));
    toast({ description: "Item has been added ", status: "success", isClosable: true });
  };

  return (
    <Wrap spacing="30px" justify="center" minHeight="100vh">
      {loading ? (
        <Stack direction="row" spacing={4}>
          <Spinner mt={20} thickness="2px" speed="0.65s" emptyColor="gray.200" color="orange.500" size="xl" />
        </Stack>
      ) : error ? (
        <Alert status="error">
          <AlertIcon />
          <AlertTitle>Oops! Something went wrong!</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : cart.length <= 0 ? (
        <Alert status="warning">
          <AlertIcon />
          <AlertTitle>Your cart is empty.</AlertTitle>
          <AlertDescription>
            <Link as={ReactLink} to="/products">
              Click here to see our products.
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        product && (
          <Box
            maxW={{ base: "3xl", lg: "5xl" }}
            mx="auto"
            px={{ base: "4", md: "8", lg: "12" }}
            py={{ base: "6", md: "8", lg: "12" }}
          >
            <Stack direction={{ base: "column", lg: "row" }} align={{ base: "flex-start" }}>
              <Stack
                pr={{ base: "0", md: "12" }}
                spacing={{ base: "8", md: "4" }}
                flex="1.5"
                mb={{
                  base: "12",
                  md: "none",
                }}
              >
                {product.productIsNew && (
                  <Badge rounded="full" w="40px" fontSize="0.8em" colorScheme="green">
                    New
                  </Badge>
                )}
                {product.stock === 0 && (
                  <Badge rounded="full" w="70px" fontSize="0.8em" colorScheme="red">
                    Sold out
                  </Badge>
                )}
                <Heading fontSize="2xl" fontWeight="extrabold">
                  {product.name}
                </Heading>
                <Stack>
                  <Box>
                    <Text fontSize={"xl"}>{product.price} Ft</Text>
                    <Flex>
                      <HStack spacing={2}>
                        <StarIcon color="purple.500" />
                        <StarIcon color={product.rating >= 2 ? "purple.500" : "gray.300"} />
                        <StarIcon color={product.rating >= 3 ? "purple.500" : "gray.300"} />
                        <StarIcon color={product.rating >= 4 ? "purple.500" : "gray.300"} />
                        <StarIcon color={product.rating >= 5 ? "purple.500" : "gray.300"} />
                      </HStack>
                      <Text fontSize={"md"} fontWeight={"bold"} ml={"4px"}>
                        {product.numberOfReviews} Reviews
                      </Text>
                    </Flex>
                  </Box>
                  <Text>{product.description}</Text>
                  <Text fontWeight={"bold"}>Quantity</Text>
                  <Flex w={"170px"} p={"5px"} borderColor={"gray.200"} alignItems={"center"}>
                    <ButtonGroup size="sm" isAttached variant="outline">
                      <IconButton
                        borderColor={"purple.500"}
                        isDisabled={amount <= 1}
                        onClick={() => changeAmount("minus")}
                        aria-label="Remove from amount"
                        icon={<MinusIcon />}
                      />
                      <Square size="32px" border={"1px"} borderColor={"purple.500"}>
                        <Text>{amount}</Text>
                      </Square>
                      <IconButton
                        borderColor={"purple.500"}
                        isDisabled={amount >= product.stock}
                        onClick={() => changeAmount("plus")}
                        aria-label="Add to amount"
                        icon={<AddIcon />}
                      />
                    </ButtonGroup>
                  </Flex>
                  <Button colorScheme="purple" onClick={() => addItem()}>
                    Add to cart
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </Box>
        )
      )}
    </Wrap>
  );
};

export default ProductScreen;
