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
import { CgSmileNone } from "react-icons/cg";
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
      ) : (
        // This ternary operator checks if the cart is not empty. If it's not empty, it displays the items in the cart.
        // Otherwise, if the cart length is 0 (empty), it shows a warning message using the Alert component from Chakra UI framework
        //cart.length <= 0 ? (
        //   <Alert status="warning">
        //     <AlertIcon />
        //     <AlertTitle>Your cart is empty.</AlertTitle>
        //     <AlertDescription>
        //       <Link as={ReactLink} to="/products">
        //         Click here to see our products.
        //       </Link>
        //     </AlertDescription>
        //   </Alert>
        // ) :
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
                  <Button isDisabled={product.stock === 0} colorScheme="purple" onClick={() => addItem()}>
                    Add to cart
                  </Button>
                  <Stack width={"270px"}>
                    <Flex alignItems={"center"}>
                      <BiPackage size={"20px"} />
                      <Text fontWeight={"medium"} fontSize={"sm"} ml={"2"}>
                        Free shipping if order above 10,000 Ft
                      </Text>
                    </Flex>
                    <Flex alignItems={"center"}>
                      <BiCheckShield size={"20px"} />
                      <Text fontWeight={"medium"} fontSize={"sm"} ml={"2"}>
                        2 year extended warrantly
                      </Text>
                    </Flex>
                    <Flex alignItems={"center"}>
                      <BiSupport size={"20px"} />
                      <Text fontWeight={"medium"} fontSize={"sm"} ml={"2"}>
                        We're here for you 24/7.
                      </Text>
                    </Flex>
                  </Stack>
                </Stack>
              </Stack>
              <Flex direction={"column"} align={"center"} flex={1} _dark={{ bg: "gray.900" }} pb={"30px"}>
                <Image
                  src={product.image}
                  alt={product.name}
                  border={"2px"}
                  borderColor={"purple.400"}
                  borderRadius={"10px"}
                  borderd
                />
              </Flex>
            </Stack>
            <Stack>
              <Text fontSize={"xl"} fontWeight={"bold"}>
                Reviews
              </Text>
              {product.reviews.length ? (
                <SimpleGrid minChildWidth="300px" spacingX="40px" spacingY="20px">
                  {product.reviews.map((review) => (
                    <Box key={review._id}>
                      <Flex spacing="2px" alignItems={"center"}>
                        <StarIcon color={"purple.500"} />
                        <StarIcon color={review >= 2 ? "purple.500" : "gray.300"} />
                        <StarIcon color={review >= 3 ? "purple.500" : "gray.300"} />
                        <StarIcon color={review >= 4 ? "purple.500" : "gray.300"} />
                        <StarIcon color={review >= 5 ? "purple.500" : "gray.300"} />
                        <Text fontWeight={"semibold"} ml={"4px"}>
                          {review.tilte && review.tilte}
                        </Text>
                      </Flex>
                      <Box py="12px">{review.comment}</Box>
                      <Text fontSize={"sm"} color={"gray.400"}>
                        {" "}
                        by {review.name}, {new Date(review.createdAt).toDateString()}
                      </Text>
                    </Box>
                  ))}
                </SimpleGrid>
              ) : (
                <Flex alignItems={"center"}>
                  <Text fontWeight={"semibold"} ml={"4px"} mr={"4px"}>
                    Sorry. There are no reviews on this product yet.{" "}
                  </Text>
                  <CgSmileNone />
                </Flex>
              )}
            </Stack>
          </Box>
        )
      )}
    </Wrap>
  );
};

export default ProductScreen;
