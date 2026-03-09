export const FIXED_ASSET_CATEGORIES = [
  { value: "IT_ORDINATEURS", label: "Informatique - Ordinateurs" },
  { value: "IT_ECRANS_ACCESSOIRES", label: "Informatique - Ecrans et accessoires" },
  { value: "IT_IMPRESSION", label: "Informatique - Imprimantes et scanners" },
  { value: "IT_SERVEURS_RESEAU", label: "Informatique - Serveurs et reseau" },
  { value: "TELEPHONIE_MOBILE", label: "Telephonie - Mobiles et tablettes" },
  { value: "MOBILIER_BUREAU", label: "Mobilier de bureau" },
  { value: "SALLE_REUNION", label: "Equipements de salle de reunion" },
  { value: "EQUIPEMENT_ELECTRIQUE", label: "Equipements electriques (onduleur, groupe)" },
  { value: "SECURITE_SURVEILLANCE", label: "Securite et surveillance" },
  { value: "VEHICULE_MOTO", label: "Vehicule - Moto" },
  { value: "VEHICULE_VOITURE", label: "Vehicule - Voiture" },
  { value: "VEHICULE_UTILITAIRE", label: "Vehicule - Utilitaire" },
  { value: "OUTILLAGE_TECHNIQUE", label: "Outillage technique" },
  { value: "AUTRE", label: "Autre" },
];

const CATEGORY_LABEL_BY_VALUE = FIXED_ASSET_CATEGORIES.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

export function getAssetCategoryLabel(value) {
  if (!value) return "-";
  return CATEGORY_LABEL_BY_VALUE[value] || value;
}
