import {
  Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Container, FormControl,
  FormErrorMessage, FormHelperText, FormLabel, Heading, Input, SimpleGrid, Stack, Text, Textarea,
} from "@chakra-ui/react";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { customOrderError, emptyCustomOrder, formatFileSize, validateCustomOrder } from "../utils/customOrders";

const CustomOrderScreen = () => {
  const [form, setForm] = useState({ ...emptyCustomOrder });
  const [file, setFile] = useState(null);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const submittingRef = useRef(false);
  const fileInputRef = useRef(null);
  const feedbackRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setConfigError(false);
    axios.get("/api/custom-orders/config", { signal: controller.signal }).then(({ data }) => {
      if (!Number.isSafeInteger(data.maxFileSizeBytes) || data.maxFileSizeBytes < 1
        // Older API processes provide upload limits without retention metadata.
        // Missing informational metadata must not disable otherwise valid uploads.
        || (data.fileRetentionDays !== undefined && (!Number.isFinite(data.fileRetentionDays) || data.fileRetentionDays <= 0))
        || !Array.isArray(data.supportedExtensions)) throw new Error("Invalid upload configuration");
      setConfig(data);
    }).catch(() => { if (!controller.signal.aborted) setConfigError(true); });
    return () => controller.abort();
  }, [configAttempt]);

  useEffect(() => {
    if (error || result) feedbackRef.current?.focus();
  }, [error, result]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const validationErrors = validateCustomOrder(form, file, config);
    setErrors(validationErrors);
    setError("");
    if (Object.keys(validationErrors).length) {
      event.currentTarget.querySelector(`[name="${Object.keys(validationErrors)[0]}"]`)?.focus();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value.trim()) body.append(key, value.trim());
    });
    if (file) body.append("modelFile", file);
    try {
      const { data } = await axios.post("/api/custom-orders", body);
      setResult(data);
    } catch (requestError) {
      setError(customOrderError(requestError, "A kérés elküldését nem sikerült megerősíteni. Kérjük, próbáld újra később."));
      const fieldErrors = requestError.response?.data?.errors;
      if (fieldErrors && typeof fieldErrors === "object") {
        setErrors(Object.fromEntries(Object.entries(fieldErrors).filter(([, value]) => typeof value === "string")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Container maxW="3xl" py={{ base: 8, md: 12 }} minH="80vh">
      <Heading size="lg" mb="3">Egyedi megrendelés</Heading>
      <Text mb="8">Mondd el, mit szeretnél 3D-ben kinyomtatni. A részletek áttekintése után felvesszük veled a kapcsolatot az árajánlattal.</Text>
      {result ? (
        <Stack spacing="6">
          <Alert status="success" alignItems="flex-start" ref={feedbackRef} tabIndex={-1}>
            <AlertIcon />
            <Box>
              <AlertTitle>Kérésedet sikeresen rögzítettük.</AlertTitle>
              <AlertDescription>Kérésazonosító: <Text as="strong" wordBreak="break-all">{result._id}</Text><br />Őrizd meg az azonosítót. Hamarosan jelentkezünk a megadott elérhetőségen.</AlertDescription>
            </Box>
          </Alert>
          <Button alignSelf="start" variant="outline" colorScheme="purple" onClick={() => {
            setResult(null); setForm({ ...emptyCustomOrder }); setFile(null); setErrors({});
          }}>Új kérés indítása</Button>
        </Stack>
      ) : (
        <Stack as="form" noValidate onSubmit={submit} spacing="6">
          {error && <Alert status="error" ref={feedbackRef} tabIndex={-1}><AlertIcon /><AlertDescription>{error}</AlertDescription></Alert>}
          <Box as="fieldset" disabled={submitting} border="0" p="0" m="0" minW="0">
            <Stack spacing="6">
              <Heading as="h2" size="md">Kapcsolattartási adatok</Heading>
              <FormControl isRequired isInvalid={Boolean(errors.customerName)}>
                <FormLabel htmlFor="customerName">Név</FormLabel>
                <Input id="customerName" name="customerName" autoComplete="name" maxLength={120} value={form.customerName} onChange={updateField} focusBorderColor="purple.500" />
                <FormErrorMessage>{errors.customerName}</FormErrorMessage>
              </FormControl>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing="6">
                <FormControl isRequired isInvalid={Boolean(errors.customerEmail)}>
                  <FormLabel htmlFor="customerEmail">E-mail-cím</FormLabel>
                  <Input id="customerEmail" name="customerEmail" type="email" autoComplete="email" maxLength={254} value={form.customerEmail} onChange={updateField} focusBorderColor="purple.500" />
                  <FormErrorMessage>{errors.customerEmail}</FormErrorMessage>
                </FormControl>
                <FormControl isRequired isInvalid={Boolean(errors.customerPhone)}>
                  <FormLabel htmlFor="customerPhone">Telefonszám</FormLabel>
                  <Input id="customerPhone" name="customerPhone" type="tel" autoComplete="tel" placeholder="+36 30 123 4567" maxLength={40} value={form.customerPhone} onChange={updateField} focusBorderColor="purple.500" />
                  <FormErrorMessage>{errors.customerPhone}</FormErrorMessage>
                </FormControl>
              </SimpleGrid>
              <Heading as="h2" size="md" pt="2">A nyomtatás részletei</Heading>
              <Text>Legalább egy leírást vagy egy modellfájlt adj meg. A többi részlet kitöltése nem kötelező.</Text>
              <FormControl isInvalid={Boolean(errors.description)}>
                <FormLabel htmlFor="description">Projekt leírása</FormLabel>
                <Textarea id="description" name="description" rows={6} maxLength={10000} placeholder="Mit szeretnél nyomtatni, és mire használnád? Szín, felület, határidő vagy egyéb fontos szempont…" value={form.description} onChange={updateField} focusBorderColor="purple.500" />
                <FormErrorMessage>{errors.description}</FormErrorMessage>
              </FormControl>
              {configError && <Alert status="warning" alignItems="flex-start"><AlertIcon /><Box><Text>A feltöltési beállítások nem tölthetők be. Leírással fájl nélkül is elküldheted a kérésed.</Text><Button size="sm" mt="2" onClick={() => setConfigAttempt((current) => current + 1)}>Beállítások újratöltése</Button></Box></Alert>}
              <FormControl isInvalid={Boolean(errors.modelFile)} isDisabled={!config}>
                <FormLabel htmlFor="modelFile">3D modellfájl</FormLabel>
                <Input id="modelFile" name="modelFile" type="file" ref={fileInputRef} accept={(config?.supportedExtensions || [".stl", ".obj", ".step", ".stp"]).join(",")} p="1" h="auto" onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setErrors((current) => ({ ...current, modelFile: undefined, description: undefined }));
                }} />
                <FormHelperText>{config ? `${config.supportedExtensions.join(", ").toUpperCase()} · Legfeljebb ${formatFileSize(config.maxFileSizeBytes)} · Egy fájl csatolható.` : configError ? "Feltöltés jelenleg nem érhető el." : "Feltöltési beállítások betöltése…"}</FormHelperText>
                {config?.fileRetentionDays !== undefined && <FormHelperText>A feltöltött modellfájlt {config.fileRetentionDays.toLocaleString("hu-HU")} napig őrizzük meg, majd automatikusan töröljük. Kérjük, tarts meg egy saját példányt.</FormHelperText>}
                <FormErrorMessage>{errors.modelFile}</FormErrorMessage>
                {file && <Button size="sm" variant="ghost" mt="2" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; setErrors((current) => ({ ...current, modelFile: undefined })); }}>Csatolmány eltávolítása</Button>}
              </FormControl>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing="6">
                <FormControl isInvalid={Boolean(errors.material)}>
                  <FormLabel htmlFor="material">Anyag (nem kötelező)</FormLabel>
                  <Input id="material" name="material" maxLength={120} placeholder="Pl. PLA, PETG, ABS" value={form.material} onChange={updateField} focusBorderColor="purple.500" />
                  <FormErrorMessage>{errors.material}</FormErrorMessage>
                </FormControl>
                <FormControl isInvalid={Boolean(errors.dimensions)}>
                  <FormLabel htmlFor="dimensions">Méretek (nem kötelező)</FormLabel>
                  <Input id="dimensions" name="dimensions" maxLength={200} placeholder="Pl. 100 × 50 × 25 mm" value={form.dimensions} onChange={updateField} focusBorderColor="purple.500" />
                  <FormErrorMessage>{errors.dimensions}</FormErrorMessage>
                </FormControl>
              </SimpleGrid>
              <FormControl isInvalid={Boolean(errors.quantity)} maxW="xs">
                <FormLabel htmlFor="quantity">Darabszám (nem kötelező)</FormLabel>
                <Input id="quantity" name="quantity" type="number" min={1} max={10000} step={1} value={form.quantity} onChange={updateField} focusBorderColor="purple.500" />
                <FormErrorMessage>{errors.quantity}</FormErrorMessage>
              </FormControl>
              <Text fontSize="sm">A kérés elküldése után egyedi árajánlatot készítünk. Ezen az oldalon nincs fizetés.</Text>
              <Button colorScheme="purple" size="lg" type="submit" isLoading={submitting} loadingText="Kérés küldése…">Kérés elküldése</Button>
            </Stack>
          </Box>
        </Stack>
      )}
    </Container>
  );
};

export default CustomOrderScreen;
