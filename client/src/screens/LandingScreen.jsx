import {
  Box,
  Flex,
  Heading,
  HStack,
  Icon,
  Image,
  Link,
  Skeleton,
  Stack,
  useColorModeValue,
  Text,
} from "@chakra-ui/react";
import { FaArrowRight } from "react-icons/fa";
import { Link as ReactLink } from "react-router-dom";

function MyImage() {
  const lightImageSrc = require("../logo/3d-printer24_24.png");
  const darkImageSrc = require("../logo/3d-printer_light.png");

  const imageSrc = useColorModeValue(lightImageSrc, darkImageSrc);
  return <img height={"36px"} width={"36px"} src={imageSrc} alt="My Image" />;
}

const Home = () => (
  <Box maxW="8xl" minH={"5xl"} mx="auto" px={{ base: "0", lg: "12" }} py={{ base: "0", lg: "12" }}>
    <Stack direction={{ base: "column-reverse", lg: "row" }} spacing={{ base: "0", lg: "20" }}>
      <Box
        width={{ lg: "sm" }}
        transform={{ base: "translateY(-50%)", lg: "none" }}
        bg={{ base: useColorModeValue("purple.50", "gray.700"), lg: "transparent" }}
        mx={{ base: "6", md: "8", lg: "0" }}
        px={{ base: "6", md: "8", lg: "0" }}
        py={{ base: "6", md: "8", lg: "12" }}
      >
        <Stack spacing={{ base: "8", lg: "10" }}>
          <Stack spacing={{ base: "2", lg: "4" }}>
            <Flex alignItems={"center"}>
              {MyImage()}
              <Text
                pl={"1"}
                fontSize="4xl"
                fontWeight={"bold"}
                color={useColorModeValue("purple.500", "purple.300")}
              >
                3D Garage
              </Text>
            </Flex>
            <Heading size="xl" fontWeight="normal">
              Bringing your ideas to life, one layer at a time
            </Heading>
          </Stack>
          <HStack spacing="3">
            <Link
              as={ReactLink}
              to={"/products"}
              color={useColorModeValue("purple.500", "purple.300")}
              fontWeight="bold"
              fontSize="lg"
            >
              Discover now
            </Link>
            <Icon as={FaArrowRight} />
          </HStack>
        </Stack>
      </Box>
      <Flex flex="1" overflow="hidden">
        <Image
          src="images/1_landing.png"
          alt="Purple Printer Image"
          fallback={<Skeleton />}
          maxH="550px"
          minW="420px"
          objectFit="cover"
          flex="1"
        />
        <Image
          display={{ base: "none", sm: "initial" }}
          src="images/2_landing.png"
          alt="Lovely Image"
          fallback={<Skeleton />}
          objectFit="cover"
          pb={"8px"}
        />
      </Flex>
    </Stack>
  </Box>
);

export default Home;
