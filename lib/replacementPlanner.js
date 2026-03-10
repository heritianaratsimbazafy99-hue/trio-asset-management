import {
  evaluateAssetHealth,
  forecastMaintenanceBudgetN1,
  normalizeScoringConfig,
} from "./predictiveEngine";

function toNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundCurrency(value) {
  return Math.round(toNumber(value));
}

export const DEFAULT_REPLACEMENT_CONFIG = {
  replacement_horizon_years: 5,
  replacement_capex_ratio: 100,
  replacement_new_asset_opex_ratio: 8,
  replacement_old_asset_opex_growth: 15,
  replacement_salvage_value_ratio: 0,
};

export function normalizeReplacementConfig(config) {
  const scoringConfig = normalizeScoringConfig(config);
  return {
    ...DEFAULT_REPLACEMENT_CONFIG,
    ...scoringConfig,
    replacement_horizon_years: Math.max(
      1,
      Math.round(
        toNumber(
          config?.replacement_horizon_years ??
            DEFAULT_REPLACEMENT_CONFIG.replacement_horizon_years
        )
      )
    ),
    replacement_capex_ratio: Math.max(
      0,
      toNumber(
        config?.replacement_capex_ratio ??
          DEFAULT_REPLACEMENT_CONFIG.replacement_capex_ratio
      )
    ),
    replacement_new_asset_opex_ratio: Math.max(
      0,
      toNumber(
        config?.replacement_new_asset_opex_ratio ??
          DEFAULT_REPLACEMENT_CONFIG.replacement_new_asset_opex_ratio
      )
    ),
    replacement_old_asset_opex_growth: Math.max(
      0,
      toNumber(
        config?.replacement_old_asset_opex_growth ??
          DEFAULT_REPLACEMENT_CONFIG.replacement_old_asset_opex_growth
      )
    ),
    replacement_salvage_value_ratio: Math.max(
      0,
      toNumber(
        config?.replacement_salvage_value_ratio ??
          DEFAULT_REPLACEMENT_CONFIG.replacement_salvage_value_ratio
      )
    ),
  };
}

function buildProjectionRows({
  horizonYears,
  annualCurrentOpex,
  annualNewAssetOpex,
  annualGrowthRate,
  netCapex,
}) {
  const rows = [];
  let keepCumulative = 0;
  let replaceCumulative = 0;

  for (let yearIndex = 1; yearIndex <= horizonYears; yearIndex += 1) {
    const keepAnnual = annualCurrentOpex * (1 + annualGrowthRate / 100) ** (yearIndex - 1);
    const replaceAnnualOpex = annualNewAssetOpex;
    const replaceAnnualCapex = yearIndex === 1 ? netCapex : 0;
    const replaceAnnualTotal = replaceAnnualCapex + replaceAnnualOpex;

    keepCumulative += keepAnnual;
    replaceCumulative += replaceAnnualTotal;

    rows.push({
      yearIndex,
      label: `Année ${yearIndex}`,
      keepAnnual: roundCurrency(keepAnnual),
      replaceAnnualOpex: roundCurrency(replaceAnnualOpex),
      replaceAnnualCapex: roundCurrency(replaceAnnualCapex),
      replaceAnnualTotal: roundCurrency(replaceAnnualTotal),
      keepCumulative: roundCurrency(keepCumulative),
      replaceCumulative: roundCurrency(replaceCumulative),
      cumulativeSavings: roundCurrency(keepCumulative - replaceCumulative),
    });
  }

  return rows;
}

export function simulateReplacementPlan({
  asset,
  incidents,
  maintenance,
  scoringConfig,
  overrides = {},
}) {
  const config = normalizeReplacementConfig({
    ...(scoringConfig || {}),
    ...(overrides || {}),
  });
  const health = evaluateAssetHealth({
    asset,
    incidents,
    maintenance,
    scoringConfig: config,
  });

  const annualCurrentOpex = Math.max(
    forecastMaintenanceBudgetN1(maintenance),
    toNumber(health.totalMaintenance)
  );
  const valuationBase = Math.max(
    toNumber(health.purchaseValue),
    toNumber(health.vnc),
    annualCurrentOpex * 2
  );
  const horizonYears = Math.max(1, toNumber(overrides.horizonYears || config.replacement_horizon_years));
  const replacementCapex = Math.max(
    0,
    toNumber(
      overrides.replacementCapex ??
        valuationBase * (config.replacement_capex_ratio / 100)
    )
  );
  const annualNewAssetOpex = Math.max(
    0,
    toNumber(
      overrides.annualNewAssetOpex ??
        replacementCapex * (config.replacement_new_asset_opex_ratio / 100)
    )
  );
  const annualGrowthRate = Math.max(
    0,
    toNumber(
      overrides.oldAssetOpexGrowthRate ?? config.replacement_old_asset_opex_growth
    )
  );
  const salvageRecovery = Math.max(
    0,
    toNumber(
      overrides.salvageRecovery ??
        health.vnc * (config.replacement_salvage_value_ratio / 100)
    )
  );
  const netCapex = Math.max(0, replacementCapex - salvageRecovery);

  const projection = buildProjectionRows({
    horizonYears,
    annualCurrentOpex,
    annualNewAssetOpex,
    annualGrowthRate,
    netCapex,
  });

  const keepTotalCost = projection.reduce((sum, row) => sum + toNumber(row.keepAnnual), 0);
  const replaceTotalCost = projection.reduce(
    (sum, row) => sum + toNumber(row.replaceAnnualTotal),
    0
  );
  const netSavings = keepTotalCost - replaceTotalCost;
  const roiPct = replacementCapex > 0 ? (netSavings / replacementCapex) * 100 : 0;
  const firstYearSavings = annualCurrentOpex - annualNewAssetOpex;
  const paybackYears =
    firstYearSavings > 0 && netCapex > 0 ? netCapex / firstYearSavings : null;
  const isRebus = String(asset?.status || "").toUpperCase() === "REBUS";
  const isCandidate = isRebus || Boolean(health.replacementRecommended);

  let priorityLabel = "Surveillance";
  if (isRebus) {
    priorityLabel = "Urgent";
  } else if (health.replacementRecommended && roiPct > 0) {
    priorityLabel = "A remplacer";
  } else if (health.replacementRecommended) {
    priorityLabel = "A arbitrer";
  }

  const priorityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (100 - toNumber(health.score)) +
          (isRebus ? 30 : 0) +
          (health.replacementRecommended ? 15 : 0) +
          Math.max(0, Math.min(20, roiPct / 5))
      )
    )
  );

  return {
    asset,
    health,
    config,
    isCandidate,
    priorityLabel,
    priorityScore,
    horizonYears,
    annualCurrentOpex: roundCurrency(annualCurrentOpex),
    annualNewAssetOpex: roundCurrency(annualNewAssetOpex),
    annualGrowthRate,
    replacementCapex: roundCurrency(replacementCapex),
    salvageRecovery: roundCurrency(salvageRecovery),
    netCapex: roundCurrency(netCapex),
    keepTotalCost: roundCurrency(keepTotalCost),
    replaceTotalCost: roundCurrency(replaceTotalCost),
    netSavings: roundCurrency(netSavings),
    roiPct: Number.isFinite(roiPct) ? Number(roiPct.toFixed(1)) : 0,
    paybackYears:
      paybackYears && Number.isFinite(paybackYears)
        ? Number(paybackYears.toFixed(1))
        : null,
    projection,
  };
}

export function aggregateReplacementPortfolio(items) {
  return (items || []).reduce(
    (acc, item) => ({
      candidateCount: acc.candidateCount + 1,
      urgentCount: acc.urgentCount + (item.priorityLabel === "Urgent" ? 1 : 0),
      totalCapex: acc.totalCapex + toNumber(item.replacementCapex),
      totalKeepCost: acc.totalKeepCost + toNumber(item.keepTotalCost),
      totalReplaceCost: acc.totalReplaceCost + toNumber(item.replaceTotalCost),
      totalNetSavings: acc.totalNetSavings + toNumber(item.netSavings),
    }),
    {
      candidateCount: 0,
      urgentCount: 0,
      totalCapex: 0,
      totalKeepCost: 0,
      totalReplaceCost: 0,
      totalNetSavings: 0,
    }
  );
}
