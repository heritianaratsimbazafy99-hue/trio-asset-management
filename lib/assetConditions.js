export const ASSET_CONDITIONS = [
  { value: "MAUVAIS", label: "Mauvais" },
  { value: "MOYEN", label: "Moyens" },
  { value: "ASSEZ_BON", label: "Assez bon" },
  { value: "BON", label: "Bon" },
  { value: "NEUF", label: "Neuf" },
];

const CONDITION_LABEL_BY_VALUE = ASSET_CONDITIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

export function getAssetConditionLabel(value) {
  if (!value) return "-";
  return CONDITION_LABEL_BY_VALUE[value] || value;
}
