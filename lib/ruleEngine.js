import { evaluateAssetHealth } from "./predictiveEngine";

function toNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export const RULE_SCOPE_OPTIONS = ["ASSET", "DATA"];
export const RULE_SEVERITY_OPTIONS = ["INFO", "WARNING", "CRITICAL"];
export const RULE_COMPARATOR_OPTIONS = [">", ">=", "<", "<=", "=", "!="];

export const DEFAULT_RULE_TEMPLATES = [
  {
    rule_code: "ASSET_INCIDENTS_12M",
    rule_name: "Incidents 12 mois",
    scope: "ASSET",
    description: "Déclenche quand un actif dépasse un nombre d'incidents sur 12 mois.",
    comparator: ">",
    threshold_value: 3,
    severity: "WARNING",
    is_enabled: true,
    params: { unit: "count" },
  },
  {
    rule_code: "ASSET_MAINTENANCE_RATIO",
    rule_name: "Ratio maintenance / valeur",
    scope: "ASSET",
    description: "Déclenche quand la maintenance dépasse un pourcentage de la valeur d'achat.",
    comparator: ">",
    threshold_value: 40,
    severity: "CRITICAL",
    is_enabled: true,
    params: { unit: "percent" },
  },
  {
    rule_code: "ASSET_VNC_RATE",
    rule_name: "Taux VNC résiduelle",
    scope: "ASSET",
    description: "Déclenche quand la VNC devient trop faible par rapport à la valeur d'achat.",
    comparator: "<=",
    threshold_value: 25,
    severity: "WARNING",
    is_enabled: true,
    params: { unit: "percent" },
  },
  {
    rule_code: "ASSET_OVERDUE_MAINTENANCE_COUNT",
    rule_name: "Maintenances en retard",
    scope: "ASSET",
    description: "Déclenche quand un actif accumule des maintenances en retard.",
    comparator: ">=",
    threshold_value: 1,
    severity: "WARNING",
    is_enabled: true,
    params: { unit: "count" },
  },
  {
    rule_code: "DATA_MISSING_PURCHASE_VALUE",
    rule_name: "Actifs sans valeur d'achat",
    scope: "DATA",
    description: "Déclenche si des actifs n'ont pas de valeur d'achat renseignée.",
    comparator: ">",
    threshold_value: 0,
    severity: "CRITICAL",
    is_enabled: true,
    params: { unit: "count" },
  },
  {
    rule_code: "DATA_MISSING_COMPANY",
    rule_name: "Actifs sans société",
    scope: "DATA",
    description: "Déclenche si des actifs ne sont rattachés à aucune société.",
    comparator: ">",
    threshold_value: 0,
    severity: "CRITICAL",
    is_enabled: true,
    params: { unit: "count" },
  },
  {
    rule_code: "DATA_MISSING_AMORTIZATION",
    rule_name: "Amortissement incomplet",
    scope: "DATA",
    description: "Déclenche si les données d'amortissement sont incomplètes.",
    comparator: ">",
    threshold_value: 0,
    severity: "WARNING",
    is_enabled: true,
    params: { unit: "count" },
  },
  {
    rule_code: "DATA_MAINTENANCE_MISSING_DEADLINE",
    rule_name: "Maintenance sans deadline",
    scope: "DATA",
    description: "Déclenche si des tickets maintenance n'ont pas de date limite.",
    comparator: ">",
    threshold_value: 0,
    severity: "WARNING",
    is_enabled: true,
    params: { unit: "count" },
  },
];

const RULE_TEMPLATE_BY_CODE = DEFAULT_RULE_TEMPLATES.reduce((acc, item) => {
  acc[item.rule_code] = item;
  return acc;
}, {});

export function getRuleTemplate(ruleCode) {
  return RULE_TEMPLATE_BY_CODE[ruleCode] || null;
}

export function normalizeRuleRow(row) {
  const template = getRuleTemplate(row?.rule_code) || {};
  return {
    ...template,
    ...(row || {}),
    rule_name: row?.rule_name || template.rule_name || row?.rule_code || "Règle",
    scope: String(row?.scope || template.scope || "ASSET").toUpperCase(),
    comparator: String(row?.comparator || template.comparator || ">").toUpperCase(),
    severity: String(row?.severity || template.severity || "WARNING").toUpperCase(),
    threshold_value: toNumber(
      row?.threshold_value ?? template.threshold_value ?? 0
    ),
    is_enabled: Boolean(row?.is_enabled ?? template.is_enabled ?? true),
    params:
      row?.params && typeof row.params === "object"
        ? row.params
        : template.params || {},
  };
}

export function normalizeRuleRows(rows = []) {
  return rows.map((item) => normalizeRuleRow(item));
}

export function compareRuleMetric(metricValue, comparator, thresholdValue) {
  const metric = toNumber(metricValue);
  const threshold = toNumber(thresholdValue);

  if (comparator === ">") return metric > threshold;
  if (comparator === ">=") return metric >= threshold;
  if (comparator === "<") return metric < threshold;
  if (comparator === "<=") return metric <= threshold;
  if (comparator === "=") return metric === threshold;
  if (comparator === "!=") return metric !== threshold;
  return false;
}

function getMetricLabel(value, params) {
  const unit = params?.unit;
  if (unit === "percent") return `${toNumber(value).toFixed(1)}%`;
  return `${Math.round(toNumber(value))}`;
}

function createRuleHit(rule, metricValue, details) {
  return {
    ...rule,
    metricValue: toNumber(metricValue),
    metricLabel: getMetricLabel(metricValue, rule.params),
    thresholdLabel: getMetricLabel(rule.threshold_value, rule.params),
    details,
  };
}

export function evaluateAssetRules({
  asset,
  incidents,
  maintenance,
  scoringConfig,
  rules,
}) {
  const health = evaluateAssetHealth({
    asset,
    incidents,
    maintenance,
    scoringConfig,
  });
  const vncRate = health.purchaseValue
    ? (health.vnc / health.purchaseValue) * 100
    : 0;

  return normalizeRuleRows(rules)
    .filter((rule) => rule.is_enabled && rule.scope === "ASSET")
    .flatMap((rule) => {
      let metricValue = 0;
      let details = "";

      if (rule.rule_code === "ASSET_INCIDENTS_12M") {
        metricValue = health.incidentCount12m;
        details = `${health.incidentCount12m} incident(s) sur 12 mois`;
      } else if (rule.rule_code === "ASSET_MAINTENANCE_RATIO") {
        metricValue = health.maintenanceRatio;
        details = `${health.maintenanceRatio.toFixed(1)}% de maintenance / valeur`;
      } else if (rule.rule_code === "ASSET_VNC_RATE") {
        metricValue = vncRate;
        details = `${vncRate.toFixed(1)}% de VNC restante`;
      } else if (rule.rule_code === "ASSET_OVERDUE_MAINTENANCE_COUNT") {
        metricValue = health.overdueMaintenanceCount;
        details = `${health.overdueMaintenanceCount} maintenance(s) en retard`;
      } else {
        return [];
      }

      if (!compareRuleMetric(metricValue, rule.comparator, rule.threshold_value)) {
        return [];
      }

      return [createRuleHit(rule, metricValue, details)];
    });
}

export function evaluateDataRules({
  assets,
  maintenance,
  rules,
}) {
  const metrics = {
    DATA_MISSING_PURCHASE_VALUE: (assets || []).filter(
      (item) => toNumber(item.purchase_value ?? item.value) <= 0
    ).length,
    DATA_MISSING_COMPANY: (assets || []).filter((item) => !item.company_id).length,
    DATA_MISSING_AMORTIZATION: (assets || []).filter(
      (item) =>
        !item.amortissement_type ||
        toNumber(item.amortissement_duration) <= 0
    ).length,
    DATA_MAINTENANCE_MISSING_DEADLINE: (maintenance || []).filter(
      (item) => !item.due_date
    ).length,
  };

  return normalizeRuleRows(rules)
    .filter((rule) => rule.is_enabled && rule.scope === "DATA")
    .flatMap((rule) => {
      const metricValue = metrics[rule.rule_code];
      if (metricValue === undefined) return [];
      if (!compareRuleMetric(metricValue, rule.comparator, rule.threshold_value)) {
        return [];
      }
      return [
        createRuleHit(
          rule,
          metricValue,
          `${metricValue} élément(s) en anomalie pour ${rule.rule_name.toLowerCase()}`
        ),
      ];
    });
}
