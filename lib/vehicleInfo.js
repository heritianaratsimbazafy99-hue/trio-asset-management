export const VEHICLE_ASSET_CATEGORIES = ["VEHICULE_VOITURE", "VEHICULE_MOTO"];

export const VEHICLE_STATUS_OPTIONS = [
  { value: "DISPONIBLE", label: "Disponible" },
  { value: "AFFECTEE", label: "Affectée" },
  { value: "EN_MAINTENANCE", label: "En maintenance" },
  { value: "IMMOBILISEE", label: "Immobilisée" },
];

export const INSURANCE_TYPE_OPTIONS = [
  { value: "TOUS_RISQUES", label: "Tous risques" },
  { value: "TIERS", label: "Tiers" },
];

export const DEFAULT_VEHICLE_INFO = {
  registration_number: "",
  brand: "",
  model: "",
  engine_displacement: "",
  chassis_number: "",
  color: "",
  assigned_agent_name: "",
  assigned_agent_contact: "",
  assigned_agent_id_number: "",
  assigned_agent_function: "",
  assignment_region: "",
  vehicle_operational_status: "DISPONIBLE",
  manager_name: "",
  manager_contact: "",
  insurance_company: "",
  insurance_type: "TOUS_RISQUES",
  policy_number: "",
  insurance_start_date: "",
  insurance_end_date: "",
  insurance_status: "",
  registration_card_number: "",
  registration_card_date: "",
};

export const VEHICLE_INFO_LABELS = {
  registration_number: "Numéro d'immatriculation",
  brand: "Marque",
  model: "Modèle",
  engine_displacement: "Cylindrée",
  chassis_number: "Numéro de châssis",
  color: "Couleur",
  assigned_agent_name: "Nom de l'agent affecté",
  assigned_agent_contact: "Contact agent",
  assigned_agent_id_number: "Matricule de l'agent",
  assigned_agent_function: "Fonction de l'agent",
  assignment_region: "Zone / Région d'affectation",
  vehicle_operational_status: "Statut de la moto",
  manager_name: "Responsable hiérarchique",
  manager_contact: "Contact responsable",
  insurance_company: "Compagnie d'assurance",
  insurance_type: "Type d'assurance",
  policy_number: "Numéro de police",
  insurance_start_date: "Date début assurance",
  insurance_end_date: "Date expiration assurance",
  insurance_status: "Statut assurance",
  registration_card_number: "Carte grise (numéro)",
  registration_card_date: "Carte grise (date)",
};

export function isVehicleCategory(category) {
  return VEHICLE_ASSET_CATEGORIES.includes(String(category || "").toUpperCase());
}

export function normalizeVehicleInfo(rawInfo) {
  const source = rawInfo && typeof rawInfo === "object" ? rawInfo : {};
  const normalized = {};

  Object.keys(DEFAULT_VEHICLE_INFO).forEach((key) => {
    const fallback = DEFAULT_VEHICLE_INFO[key];
    const rawValue = source[key] ?? fallback ?? null;

    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      normalized[key] = trimmed === "" ? null : trimmed;
      return;
    }

    normalized[key] = rawValue;
  });

  return normalized;
}

export function vehicleInfoValue(info, key, fallback = "-") {
  const value = info?.[key];
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}
