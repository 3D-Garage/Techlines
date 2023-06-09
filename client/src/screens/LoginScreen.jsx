import {
  Box,
  Button,
  Checkbox,
  Container,
  FormControl,
  Heading,
  Stack,
  HStack,
  Text,
  useBreakpointValue,
  useColorModeValue,
  Alert,
  AlertIcon,
  AlertDescription,
  AlertTitle,
  useToast,
} from "@chakra-ui/react";
import { useState, useEffect } from "react";
import { Formik } from "formik";
import * as Yup from "yup";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, Link as ReactLink, useLocation } from "react-router-dom";
import PasswordTextField from "../components/PasswordTextField";
import TextField from "../components/TextField";
import { login } from "../redux/actions/userActions";
import { FaUser } from "react-icons/fa";

//TODO: redefine password length
const LoginScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const redirect = "/products";
  const toast = useToast();

  const user = useSelector((state) => state.user);
  const { loading, error, userInfo } = user;

  const headingBR = useBreakpointValue({ base: "xs", md: "sm" });
  const boxBR = useBreakpointValue({ base: "transparent", md: "bg-surface" });

  useEffect(() => {
    if (userInfo) {
      if (location.state?.from) {
        navigate(location.state.from);
      } else {
        navigate(redirect);
      }
      toast({
        description: "Login succsessful",
        status: "success",
        isClosable: true,
      });
    }
  }, [userInfo, redirect, error, navigate, toast, location.state]);

  return (
    <Formik
      initialValues={{ email: "", password: "" }}
      validationSchema={Yup.object({
        email: Yup.string().email("Invalid email").required("An email address is required."),
        password: Yup.string()
          .min(1, "Password is to short - must contain at least 1 character.")
          .required("Password is required"),
      })}
      onSubmit={(values) => {
        dispatch(login(values.email, values.password));
      }}
    >
      {(formik) => (
        <Container maxW="lg" py={{ base: "12", md: "24" }} px={{ base: "0", md: "8" }} minH="4xl">
          {" "}
          <Stack spacing="8">
            <Stack spacing="6">
              <Stack spacing={{ base: "2", md: "3" }} textAlign="center">
                <Heading size={headingBR}>Login to your account</Heading>
                <HStack spacing="1" justify="center">
                  <Text color="muted">Don't have an account?</Text>
                  <Button as={ReactLink} to="/registration" variant="link" colorScheme="purple">
                    Sign up
                  </Button>
                </HStack>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    color: "#d6bcfa",
                  }}
                >
                  <FaUser fontSize={"1.25rem"} />
                </div>
              </Stack>
            </Stack>
            <Box
              py={{ base: "0", md: "8" }}
              px={{ base: "4", md: "10" }}
              bg={{ boxBR }}
              boxShadow={{ base: "none", md: "xl" }}
            >
              <Stack spacing="6" as="form" onSubmit={formik.handleSubmit}>
                {error && (
                  <Alert
                    status="error"
                    flexDirection="column"
                    alignItems="center"
                    justifyContent="center"
                    textAlign="center"
                  >
                    <AlertIcon />
                    <AlertTitle>Upps! We are sorry!</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Stack spacing="5">
                  <FormControl>
                    <TextField type="text" name="email" placeholder="you@example.com" label="Email" />
                    <PasswordTextField
                      type="password"
                      name="password"
                      placeholder="your password"
                      label="Password"
                    />
                  </FormControl>
                </Stack>
                <Stack spacing="6">
                  <Button colorScheme="purple" size="lg" fontSize="md" isLoading={loading} type="submit">
                    Sign in
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </Container>
      )}
    </Formik>
  );
};

export default LoginScreen;
