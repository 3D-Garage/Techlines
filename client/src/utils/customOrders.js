export const customOrderStatuses = {
  new: { label: "Új", color: "blue" },
  review: { label: "Áttekintés alatt", color: "yellow" },
  quoted: { label: "Árajánlat elküldve", color: "purple" },
  accepted: { label: "Elfogadva", color: "cyan" },
  printing: { label: "Nyomtatás alatt", color: "orange" },
  completed: { label: "Elkészült", color: "green" },
  rejected: { label: "Elutasítva", color: "red" },
};

export const emptyCustomOrder = {
  customerName: "", customerEmail: "", customerPhone: "", description: "",
  material: "", dimensions: "", quantity: "",
};

export const formatFileSize = (bytes) => {
  const divisor = bytes >= 1024 * 1024 ? 1024 * 1024 : bytes >= 1024 ? 1024 : 1;
  const unit = divisor === 1 ? "B" : divisor === 1024 ? "KB" : "MB";
  return `${(bytes / divisor).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${unit}`;
};
export const formatOrderDate = (date) => date ? new Date(date).toLocaleString("hu-HU") : "—";

export const customOrderError = (error, fallback) => {
  if (error.response?.status === 429) return "Túl sok kérés érkezett. Kérjük, próbáld újra később.";
  return typeof error.response?.data?.message === "string" ? error.response.data.message : fallback;
};

export const validateCustomOrder = (values, file, config) => {
  const errors = {};
  if (!values.customerName.trim()) errors.customerName = "Add meg a neved.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.customerEmail.trim())) errors.customerEmail = "Adj meg egy érvényes e-mail-címet.";
  const phone = values.customerPhone.trim();
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    errors.customerPhone = "Adj meg egy érvényes telefonszámot (7–15 számjegy).";
  }
  if (!values.description.trim() && !file) errors.description = "Írd le az elképzelésed, vagy csatolj egy modellfájlt.";
  if (values.quantity && (!/^\d+$/.test(values.quantity) || Number(values.quantity) < 1 || Number(values.quantity) > 10000)) {
    errors.quantity = "A darabszám 1 és 10 000 közötti egész szám lehet.";
  }
  if (file) {
    const extension = `.${file.name.split(".").pop().toLowerCase()}`;
    if (!config) errors.modelFile = "A feltöltési beállítások még nem érhetők el. Próbáld újra a betöltésüket.";
    else if (!config.supportedExtensions.includes(extension)) errors.modelFile = "Nem támogatott fájltípus. STL, OBJ, STEP vagy STP fájlt válassz.";
    else if (file.size === 0) errors.modelFile = "A kiválasztott fájl üres.";
    else if (file.size > config.maxFileSizeBytes) errors.modelFile = `A fájl legfeljebb ${formatFileSize(config.maxFileSizeBytes)} lehet.`;
  }
  return errors;
};
