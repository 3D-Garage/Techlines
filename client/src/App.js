import { ChakraProvider } from "@chakra-ui/react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProductsScreen from "./screens/ProductsScreen";
import CartScreen from "./screens/CartScreen";
import ProductScreen from "./screens/ProductScreen";
import Footer from "./components/Footer";
import Home from "./screens/LandingScreen";

function App() {
  return (
    <ChakraProvider>
      <Router>
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home></Home>}></Route>
            <Route path="/product/:id" element={<ProductScreen></ProductScreen>}></Route>
            <Route path="/products" element={<ProductsScreen></ProductsScreen>}></Route>
            <Route path="/cart" element={<CartScreen></CartScreen>}></Route>
          </Routes>
        </main>
        <Footer />
      </Router>
    </ChakraProvider>
  );
}

export default App;
