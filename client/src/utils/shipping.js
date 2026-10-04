export function normalizeRecipientPhone(value = "") {
  if (typeof value !== "string" || value.length > 40 || !/^[+\d\s()-]+$/.test(value)) return null;
  let phone = value.replace(/[\s()-]/g, "");
  if (phone.startsWith("0036")) phone = `+36${phone.slice(4)}`;
  else if (phone.startsWith("06")) phone = `+36${phone.slice(2)}`;
  else if (/^36\d{9}$/.test(phone)) phone = `+${phone}`;
  else if (/^\d{9}$/.test(phone)) phone = `+36${phone}`;
  return /^\+36(?:20|30|31|50|51|70)\d{7}$/.test(phone) ? phone : null;
}
export function shippingMethodLabel(method) {
  switch (method) {
    case "standard": return "Standard házhoz szállítás";
    case "express": return "Express házhoz szállítás";
    case "foxpost": return "FOXPOST csomagautomata";
    default: return "Házhoz szállítás";
  }
}
export const shippingDraftKey = (userId) => `shippingDraft:${userId}`;
export function readShippingDraft(userId) {
  try { return JSON.parse(localStorage.getItem(shippingDraftKey(userId))) || {}; } catch (_error) { return {}; }
}
