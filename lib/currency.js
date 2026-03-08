const ARIARY_FORMATTER = new Intl.NumberFormat("fr-MG", {
  style: "currency",
  currency: "MGA",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMGA(value) {
  const numericValue = Number(value || 0);
  return ARIARY_FORMATTER.format(Number.isFinite(numericValue) ? numericValue : 0);
}
