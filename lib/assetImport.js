const VEHICLE_IMPORT_FIELDS = [
  "registration_number",
  "brand",
  "model",
  "engine_displacement",
  "chassis_number",
  "color",
  "assigned_agent_name",
  "assigned_agent_contact",
  "assigned_agent_id_number",
  "assigned_agent_function",
  "assignment_region",
  "vehicle_operational_status",
  "manager_name",
  "manager_contact",
  "insurance_company",
  "insurance_type",
  "policy_number",
  "insurance_start_date",
  "insurance_end_date",
  "registration_card_number",
  "registration_card_date",
];

export const ASSET_IMPORT_TEMPLATE_COLUMNS = [
  "name",
  "code",
  "category",
  "company_name",
  "purchase_date",
  "purchase_value",
  "status",
  "current_condition",
  "amortissement_type",
  "amortissement_duration",
  "assigned_to_name",
  "description",
  ...VEHICLE_IMPORT_FIELDS,
];

const IMPORT_HEADER_ALIASES = {
  name: "name",
  nom: "name",
  assetname: "name",
  designation: "name",
  code: "code",
  assetcode: "code",
  category: "category",
  categorie: "category",
  company: "company_name",
  companyname: "company_name",
  societe: "company_name",
  societenom: "company_name",
  companyid: "company_id",
  societeid: "company_id",
  purchasedate: "purchase_date",
  dateachat: "purchase_date",
  purchasevalue: "purchase_value",
  valeurachat: "purchase_value",
  valueachat: "purchase_value",
  statut: "status",
  status: "status",
  currentcondition: "current_condition",
  etatactuel: "current_condition",
  conditionactuelle: "current_condition",
  amortissementtype: "amortissement_type",
  typeamortissement: "amortissement_type",
  amortissementduration: "amortissement_duration",
  dureeamortissement: "amortissement_duration",
  assignedtoname: "assigned_to_name",
  attribuea: "assigned_to_name",
  assignedtouserid: "assigned_to_user_id",
  description: "description",
  observations: "description",
  commentaire: "description",
  registrationnumber: "registration_number",
  numeroimmatriculation: "registration_number",
  immatriculation: "registration_number",
  brand: "brand",
  marque: "brand",
  model: "model",
  modele: "model",
  enginedisplacement: "engine_displacement",
  cylindree: "engine_displacement",
  chassisnumber: "chassis_number",
  numerodechassis: "chassis_number",
  color: "color",
  couleur: "color",
  assignedagentname: "assigned_agent_name",
  agentaffecte: "assigned_agent_name",
  assignedagentcontact: "assigned_agent_contact",
  contactagent: "assigned_agent_contact",
  assignedagentidnumber: "assigned_agent_id_number",
  matriculeagent: "assigned_agent_id_number",
  assignedagentfunction: "assigned_agent_function",
  fonctionagent: "assigned_agent_function",
  assignmentregion: "assignment_region",
  regionaffectation: "assignment_region",
  zoneaffectation: "assignment_region",
  vehicleoperationalstatus: "vehicle_operational_status",
  statutvehicule: "vehicle_operational_status",
  managername: "manager_name",
  responsablehierarchique: "manager_name",
  managercontact: "manager_contact",
  contactresponsable: "manager_contact",
  insurancecompany: "insurance_company",
  compagnieassurance: "insurance_company",
  insurancetype: "insurance_type",
  typeassurance: "insurance_type",
  policynumber: "policy_number",
  numeropolice: "policy_number",
  insurancestartdate: "insurance_start_date",
  datedebutassurance: "insurance_start_date",
  insuranceenddate: "insurance_end_date",
  dateexpirationassurance: "insurance_end_date",
  registrationcardnumber: "registration_card_number",
  numerocartegrise: "registration_card_number",
  registrationcarddate: "registration_card_date",
  datecartegrise: "registration_card_date",
};

function normalizeHeaderKey(header) {
  return String(header || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function canonicalizeHeader(header) {
  return IMPORT_HEADER_ALIASES[normalizeHeaderKey(header)] || null;
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value).trim();
}

function normalizeParsedRow(rawRow) {
  const normalizedRow = {};

  Object.entries(rawRow || {}).forEach(([header, value]) => {
    const canonicalHeader = canonicalizeHeader(header);
    if (!canonicalHeader) return;
    normalizedRow[canonicalHeader] = normalizeCellValue(value);
  });

  return normalizedRow;
}

function hasRecognizedColumns(rows = []) {
  return rows.some((row) => Object.keys(row || {}).length > 0);
}

export async function parseAssetImportFile(file) {
  if (!file) {
    throw new Error("Aucun fichier sélectionné.");
  }

  const lowerName = String(file.name || "").toLowerCase();
  if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
    throw new Error("Formats acceptés: .csv, .xlsx, .xls");
  }

  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: true,
    dense: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Le fichier ne contient aucune feuille exploitable.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: true,
    blankrows: false,
  });

  const normalizedRows = rawRows
    .map((row) => normalizeParsedRow(row))
    .filter((row) => Object.values(row).some((value) => String(value || "").trim() !== ""));

  if (!normalizedRows.length) {
    throw new Error("Le fichier est vide ou ne contient aucune ligne exploitable.");
  }

  if (!hasRecognizedColumns(normalizedRows)) {
    throw new Error("Aucune colonne reconnue. Utilise le modèle d'import fourni.");
  }

  if (normalizedRows.length > 1000) {
    throw new Error("Le lot maximal supporté est de 1000 lignes par import.");
  }

  return normalizedRows;
}

function sanitizeCsvCell(value) {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(";") || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export function downloadAssetImportTemplate() {
  const sampleRow = {
    name: "Laptop Direction",
    code: "",
    category: "IT_ORDINATEURS",
    company_name: "Mobix",
    purchase_date: "2026-03-10",
    purchase_value: "1800000",
    status: "EN_SERVICE",
    current_condition: "BON",
    amortissement_type: "LINEAIRE",
    amortissement_duration: "5",
    assigned_to_name: "Direction Générale",
    description: "Import test dry-run",
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
    vehicle_operational_status: "",
    manager_name: "",
    manager_contact: "",
    insurance_company: "",
    insurance_type: "",
    policy_number: "",
    insurance_start_date: "",
    insurance_end_date: "",
    registration_card_number: "",
    registration_card_date: "",
  };

  const rows = [
    ASSET_IMPORT_TEMPLATE_COLUMNS,
    ASSET_IMPORT_TEMPLATE_COLUMNS.map((key) => sampleRow[key] || ""),
  ];

  const csv = rows.map((line) => line.map(sanitizeCsvCell).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modele_import_actifs.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
