import { Alert, AlertIcon, Box, Button, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Spinner, Stack, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

export const FOXPOST_WIDGET_URL = "https://cdn.foxpost.hu/apt-finder/v1/app/";
export const FOXPOST_WIDGET_ORIGIN = "https://cdn.foxpost.hu";

export default function FoxpostLockerPicker({ isOpen, onClose, lockers, onSelect }) {
  const frame = useRef(null);
  const selection = useRef({ lockers, onSelect });
  selection.current = { lockers, onSelect };
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const loadTimer = useRef();
  useEffect(() => {
    if (!isOpen) return;
    setLoaded(false);
    setError("");
    loadTimer.current = setTimeout(() => setError("A FOXPOST választó nem töltődött be. Próbáld újra, vagy válassz másik szállítási módot."), 20000);
    const receive = (event) => {
      if (event.origin !== FOXPOST_WIDGET_ORIGIN || event.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        const point = selection.current.lockers.find((locker) => locker.place_id === String(data?.place_id));
        if (!point) { setError("Csak elérhető magyarországi FOXPOST A-BOX és FOXPOST Z-BOX automata választható. Más partnerpont vagy telített automata nem használható."); return; }
        selection.current.onSelect(point);
      } catch (_error) { setError("A választó érvénytelen adatot küldött. Próbáld újra az automataválasztást."); }
    };
    window.addEventListener("message", receive);
    return () => { clearTimeout(loadTimer.current); window.removeEventListener("message", receive); };
  }, [isOpen, version]);
  return <Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
    <ModalOverlay /><ModalContent mx={{ base: 2, md: 6 }} my={{ base: 3, md: 8 }} maxH="95dvh">
      <ModalHeader>FOXPOST automata választása</ModalHeader><ModalCloseButton />
      <ModalBody pb="5"><Stack spacing="3">
        <Text>Csak magyarországi FOXPOST A-BOX és FOXPOST Z-BOX választható. Packeta partnerpont nem választható.</Text>
        {error && <Alert status="error"><AlertIcon />{error}</Alert>}
        {!loaded && !error && <Spinner aria-label="FOXPOST választó betöltése" />}
        <Button alignSelf="start" size="sm" onClick={() => setVersion((value) => value + 1)}>Választó újratöltése</Button>
        <Text fontSize="sm">Ha a térkép vagy a lista nem működik, töltsd újra a választót. Az ablak bezárása után másik szállítási módot is választhatsz.</Text>
        <Box as="iframe" ref={frame} key={version} src={FOXPOST_WIDGET_URL} title="FOXPOST térképes és listás automataválasztó" width="100%" height={{ base: "65dvh", md: "650px" }} minH="350px" border="0" onLoad={() => { clearTimeout(loadTimer.current); setLoaded(true); }} onError={() => setError("A FOXPOST választó nem tölthető be. Próbáld újra.")} />
      </Stack></ModalBody>
    </ModalContent>
  </Modal>;
}
