export const FOXPOST_LIST_URL = "https://cdn.foxpost.hu/foxplus.json";
const CACHE_TTL = 60 * 60 * 1000;
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

export function normalizeRecipientPhone(value) {
  if (typeof value !== "string" || value.length > 40 || !/^[+\d\s()-]+$/.test(value)) throw fail("Adj meg érvényes magyar mobiltelefonszámot.", 400);
  let phone = value.replace(/[\s()-]/g, "");
  if (phone.startsWith("0036")) phone = `+36${phone.slice(4)}`;
  else if (phone.startsWith("06")) phone = `+36${phone.slice(2)}`;
  else if (/^36\d{9}$/.test(phone)) phone = `+${phone}`;
  else if (/^\d{9}$/.test(phone)) phone = `+36${phone}`;
  if (!/^\+36(?:20|30|31|50|51|70)\d{7}$/.test(phone)) throw fail("Adj meg érvényes magyar mobiltelefonszámot (például +36 30 123 4567).", 400);
  return phone;
}

export function normalizeLocker(point, now = Date.now()) {
  const types = { "FOXPOST A-BOX": "A-BOX", "FOXPOST Z-BOX": "Z-BOX" };
  const type = types[point?.variant];
  const services = Array.isArray(point?.service) ? point.service : [point?.service];
  if (!type || String(point.country).toUpperCase() !== "HU" || !services.includes("pick up") || point.load === "overloaded" || point.closed === true) return null;
  if (point.closeDate) {
    const closedAt = Date.parse(point.closeDate);
    // Unknown closure data is rejected conservatively; future closures are allowed.
    if (!Number.isFinite(closedAt) || closedAt <= now) return null;
  }
  const text = (value) => typeof value === "string" && value.trim() && !/[\x00-\x1f]/.test(value) ? value.trim() : null;
  const place_id = String(point.place_id ?? "");
  const operator_id = text(point.operator_id);
  const name = text(point.name), address = text(point.address), street = text(point.street), city = text(point.city), postalCode = text(point.zip);
  if (!/^\d{1,20}$/.test(place_id) || !operator_id || !name || !address || !street || !city || !/^\d{4}$/.test(postalCode)) return null;
  return { place_id, operator_id, name, type, address, street, city, postalCode, country: "HU" };
}

// The factory keeps the clock and transport replaceable in deterministic tests.
export function createFoxpostDirectory({ fetchList = (...args) => fetch(...args), now = Date.now } = {}) {
  let cache, pending;
  return {
    async getLockers() {
      if (cache && now() < cache.expiresAt) return cache.lockers;
      if (!pending) pending = Promise.resolve().then(async () => {
        try {
          const response = await fetchList(FOXPOST_LIST_URL, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error("FOXPOST list HTTP error");
          const points = await response.json();
          if (!Array.isArray(points) || !points.length) throw new Error("Invalid FOXPOST list");
          const lockers = points.map((point) => normalizeLocker(point, now())).filter(Boolean);
          cache = { lockers, expiresAt: now() + CACHE_TTL };
          return lockers;
        } catch (_error) {
          throw fail("A FOXPOST automatalista nem érhető el. Próbáld újra, vagy válassz másik szállítási módot.", 503);
        } finally { pending = null; }
      });
      return pending;
    },
  };
}
let directory = createFoxpostDirectory();
export const __setFoxpostDirectory = (value) => { directory = value || createFoxpostDirectory(); };
export const getFoxpostLockers = () => directory.getLockers();
export async function resolveFoxpostLocker(id) {
  const locker = (await getFoxpostLockers()).find((point) => point.place_id === id);
  if (!locker) throw fail("Ez az átvételi pont nem választható. Válassz elérhető magyarországi FOXPOST A-BOX vagy FOXPOST Z-BOX automatát.", 400);
  return locker;
}
export const lockerShippingAddress = (locker) => ({ address: locker.street, city: locker.city, postalCode: locker.postalCode, country: locker.country });
