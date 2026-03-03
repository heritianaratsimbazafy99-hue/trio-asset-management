function toNumber(value) {
  return Number(value || 0);
}

function toDate(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function getDegressiveCoefficient(durationYears) {
  const duration = toNumber(durationYears);
  if (duration <= 0) return 1;
  if (duration <= 4) return 1.25;
  if (duration <= 6) return 1.75;
  return 2.25;
}

export function buildAmortizationSchedule({
  purchaseValue,
  durationYears,
  purchaseDate,
  amortType,
}) {
  const value = toNumber(purchaseValue);
  const duration = Math.max(0, Math.floor(toNumber(durationYears)));
  if (!value || !duration) return [];

  const startYear = toDate(purchaseDate).getFullYear();
  const linearAnnual = value / duration;
  const coefficient = getDegressiveCoefficient(duration);
  const degressiveRate = (coefficient / duration) * 100;

  const rows = [];
  let vncStart = value;

  for (let i = 1; i <= duration; i++) {
    const yearsRemaining = duration - i + 1;
    const linearRemaining = vncStart / yearsRemaining;
    const degressiveAnnual = vncStart * (degressiveRate / 100);

    const isDegressive = String(amortType || "LINEAIRE").toUpperCase() === "DEGRESSIF";
    const useLinear = !isDegressive || degressiveAnnual <= linearRemaining;
    const annual = useLinear ? linearRemaining : degressiveAnnual;
    const appliedMethod = useLinear ? "LINEAIRE" : "DEGRESSIF";

    const amortized = Math.min(vncStart, annual);
    const vncEnd = Math.max(0, vncStart - amortized);

    rows.push({
      yearIndex: i,
      year: startYear + i - 1,
      method: appliedMethod,
      annual: amortized,
      cumulative: value - vncEnd,
      vncStart,
      vncEnd,
      linearAnnual,
      degressiveRate,
    });

    vncStart = vncEnd;
  }

  return rows;
}

export function computeCurrentVnc(schedule) {
  if (!schedule || schedule.length === 0) return 0;
  const currentYear = new Date().getFullYear();

  const rowForYear = schedule.find((row) => row.year === currentYear);
  if (rowForYear) return rowForYear.vncEnd;

  const lastPast = [...schedule]
    .filter((row) => row.year < currentYear)
    .pop();

  if (lastPast) return lastPast.vncEnd;
  return schedule[0].vncStart;
}

export function sumMaintenanceCost(maintenanceItems) {
  return (maintenanceItems || []).reduce(
    (sum, item) => sum + toNumber(item.cost),
    0
  );
}

export function groupMaintenanceByMonth(maintenanceItems, months = 12) {
  const grouped = {};

  (maintenanceItems || []).forEach((item) => {
    const d = toDate(item.date || item.created_at || item.updated_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    grouped[key] = (grouped[key] || 0) + toNumber(item.cost);
  });

  return Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .slice(-months)
    .map((month) => ({ month, value: grouped[month] }));
}
