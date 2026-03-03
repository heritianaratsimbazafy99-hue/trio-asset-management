import {
  buildAmortizationSchedule,
  computeCurrentVnc,
  sumMaintenanceCost,
  groupMaintenanceByMonth,
} from "./financeEngine";

function toNumber(value) {
  return Number(value || 0);
}

function countIncidentsSinceDays(incidents, days = 365) {
  const now = Date.now();
  const rangeMs = days * 24 * 60 * 60 * 1000;
  return (incidents || []).filter((item) => {
    const d = new Date(item.created_at || item.date || 0).getTime();
    return Number.isFinite(d) && now - d <= rangeMs;
  }).length;
}

const DEFAULT_SCORING_CONFIG = {
  weight_incidents: 7,
  weight_maintenance_ratio: 1,
  weight_vnc_zero: 10,
  incident_threshold: 3,
  replacement_ratio_threshold: 40,
  replacement_vnc_threshold: 25,
  top_risk_days: 30,
};

export function normalizeScoringConfig(config) {
  return {
    ...DEFAULT_SCORING_CONFIG,
    ...(config || {}),
    weight_incidents: toNumber(config?.weight_incidents || DEFAULT_SCORING_CONFIG.weight_incidents),
    weight_maintenance_ratio: toNumber(
      config?.weight_maintenance_ratio || DEFAULT_SCORING_CONFIG.weight_maintenance_ratio
    ),
    weight_vnc_zero: toNumber(config?.weight_vnc_zero || DEFAULT_SCORING_CONFIG.weight_vnc_zero),
    incident_threshold: Math.max(
      1,
      Math.round(toNumber(config?.incident_threshold || DEFAULT_SCORING_CONFIG.incident_threshold))
    ),
    replacement_ratio_threshold: toNumber(
      config?.replacement_ratio_threshold || DEFAULT_SCORING_CONFIG.replacement_ratio_threshold
    ),
    replacement_vnc_threshold: toNumber(
      config?.replacement_vnc_threshold || DEFAULT_SCORING_CONFIG.replacement_vnc_threshold
    ),
    top_risk_days: Math.max(
      1,
      Math.round(toNumber(config?.top_risk_days || DEFAULT_SCORING_CONFIG.top_risk_days))
    ),
  };
}

export function forecastMaintenanceBudgetN1(maintenanceItems) {
  const monthly = groupMaintenanceByMonth(maintenanceItems, 12);
  if (monthly.length === 0) return 0;

  const total = monthly.reduce((sum, row) => sum + toNumber(row.value), 0);
  const averageMonthly = total / monthly.length;
  return averageMonthly * 12;
}

export function evaluateAssetHealth({
  asset,
  incidents,
  maintenance,
  scoringConfig,
}) {
  const config = normalizeScoringConfig(scoringConfig);
  const purchaseValue = toNumber(asset?.purchase_value ?? asset?.value);
  const duration = toNumber(
    asset?.amortissement_duration ?? asset?.amortization_duration
  );
  const schedule = buildAmortizationSchedule({
    purchaseValue,
    durationYears: duration,
    purchaseDate: asset?.purchase_date,
    amortType: asset?.amortissement_type || "LINEAIRE",
  });
  const vnc = computeCurrentVnc(schedule);
  const totalMaintenance = sumMaintenanceCost(maintenance);
  const maintenanceRatio = purchaseValue
    ? (totalMaintenance / purchaseValue) * 100
    : 0;
  const incidentCount12m = countIncidentsSinceDays(incidents, 365);
  const incidentCount30d = countIncidentsSinceDays(
    incidents,
    config.top_risk_days
  );
  const overdueMaintenanceCount = (maintenance || []).filter((item) => {
    if (item.is_completed) return false;
    if (!item.due_date) return false;
    const due = new Date(item.due_date).getTime();
    return Number.isFinite(due) && due < Date.now();
  }).length;

  const alerts = [];
  if (maintenanceRatio > config.replacement_ratio_threshold) {
    alerts.push(
      `Maintenance > ${config.replacement_ratio_threshold}% de la valeur d'achat`
    );
  }
  if (incidentCount12m > config.incident_threshold) {
    alerts.push(`Plus de ${config.incident_threshold} incidents sur 12 mois`);
  }
  if (vnc === 0 && totalMaintenance > 0) {
    alerts.push("VNC nulle avec cout de maintenance actif");
  }
  if (overdueMaintenanceCount > 0) {
    alerts.push(`${overdueMaintenanceCount} maintenance(s) en retard`);
  }

  const rentable = maintenanceRatio <= config.replacement_ratio_threshold;
  const replacementRecommended =
    maintenanceRatio > config.replacement_ratio_threshold ||
    (incidentCount12m > config.incident_threshold &&
      vnc <= purchaseValue * (config.replacement_vnc_threshold / 100));

  const maintenancePenalty = Math.min(
    60,
    maintenanceRatio * config.weight_maintenance_ratio
  );
  const incidentPenalty = Math.min(
    35,
    incidentCount12m * config.weight_incidents
  );
  const vncPenalty = vnc === 0 ? config.weight_vnc_zero : 0;
  const slaPenalty = Math.min(20, overdueMaintenanceCount * 5);

  let score = 100;
  score -= maintenancePenalty;
  score -= incidentPenalty;
  score -= vncPenalty;
  score -= slaPenalty;
  score = Math.max(0, Math.round(score));

  const recommendation = replacementRecommended
    ? "Remplacement recommande"
    : rentable
      ? "Actif rentable"
      : "Surveillance renforcee";

  return {
    purchaseValue,
    duration,
    schedule,
    vnc,
    totalMaintenance,
    maintenanceRatio,
    incidentCount12m,
    alerts,
    rentable,
    replacementRecommended,
    score,
    recommendation,
    incidentCount30d,
    overdueMaintenanceCount,
    scoringConfig: config,
    scoreBreakdown: {
      maintenancePenalty: Math.round(maintenancePenalty),
      incidentPenalty: Math.round(incidentPenalty),
      vncPenalty: Math.round(vncPenalty),
      slaPenalty: Math.round(slaPenalty),
    },
  };
}
