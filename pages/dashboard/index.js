import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { buildAmortizationSchedule, groupMaintenanceByMonth } from "../../lib/financeEngine";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import { evaluateAssetHealth, forecastMaintenanceBudgetN1 } from "../../lib/predictiveEngine";

function formatEUR(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

const PERIOD_OPTIONS = [
  { value: "30D", label: "30 jours" },
  { value: "90D", label: "90 jours" },
  { value: "YTD", label: "Depuis Janvier" },
  { value: "12M", label: "12 mois" },
  { value: "ALL", label: "Tout" },
];

function getPeriodStart(period) {
  const now = new Date();
  if (period === "30D") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  if (period === "90D") {
    return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }
  if (period === "YTD") {
    return new Date(now.getFullYear(), 0, 1);
  }
  if (period === "12M") {
    return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  }
  return null;
}

function toTs(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthSeries(rows, months = 12) {
  const source = {};
  (rows || []).forEach((row) => {
    source[row.month] = Number(row.value || 0);
  });

  const now = new Date();
  const filled = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    filled.push({ month: key, value: source[key] || 0, type: "actual" });
  }
  return filled;
}

function appendForecast(series, months = 3) {
  if (!series.length) return [];
  const result = [...series];
  const recent = series.slice(-Math.min(6, series.length)).map((item) => item.value);
  const deltas = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push(recent[i] - recent[i - 1]);
  }
  const avgDelta =
    deltas.length > 0
      ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      : 0;
  const avgBase =
    recent.length > 0
      ? recent.reduce((sum, value) => sum + value, 0) / recent.length
      : 0;
  let lastValue = series[series.length - 1].value;
  const [y, m] = series[series.length - 1].month.split("-").map(Number);

  for (let i = 1; i <= months; i++) {
    const d = new Date(y, m - 1 + i, 1);
    lastValue = Math.max(0, lastValue + avgDelta);
    const lower = Math.max(0, lastValue * 0.85);
    const upper = Math.max(lastValue, lastValue * 1.15);
    result.push({
      month: monthKey(d),
      value: null,
      forecast: Math.round(lastValue),
      forecastLower: Math.round(lower),
      forecastUpper: Math.round(upper),
      base: Math.round(avgBase),
      type: "forecast",
    });
  }

  return result.map((item) => ({
    ...item,
    forecast: item.forecast ?? null,
    forecastLower: item.forecastLower ?? null,
    forecastUpper: item.forecastUpper ?? null,
  }));
}

export default function Dashboard() {
  const router = useRouter();
  const [assets, setAssets] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [organisations, setOrganisations] = useState([]);
  const [scoringConfigs, setScoringConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [secondaryReady, setSecondaryReady] = useState(false);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [userRole, setUserRole] = useState("");

  const [selectedCompanyId, setSelectedCompanyId] = useState("ALL");
  const [selectedPeriod, setSelectedPeriod] = useState("12M");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [focusedAssetId, setFocusedAssetId] = useState("");

  const canCloseOps = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.RESPONSABLE_MAINTENANCE,
  ]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setSecondaryReady(false);
    const timeout = setTimeout(() => setSecondaryReady(true), 160);
    return () => clearTimeout(timeout);
  }, [assets, maintenance, incidents, selectedCompanyId, selectedPeriod, selectedCategory]);

  async function fetchData() {
    setLoading(true);
    setError("");

    const [
      { data: assetsData, error: assetsError },
      { data: maintenanceData, error: maintenanceError },
      { data: incidentsData, error: incidentsError },
      { data: organisationsData },
      { data: scoringData },
      { profile },
    ] = await Promise.all([
      supabase
        .from("assets")
        .select("id,name,code,category,purchase_value,value,status,company_id,amortissement_duration,amortissement_type,purchase_date,created_at,organisations(name)"),
      supabase
        .from("maintenance")
        .select("*, assets(id,name,company_id,organisations(name))"),
      supabase
        .from("incidents")
        .select("*, assets(id,name,company_id,organisations(name))"),
      supabase.from("organisations").select("id,name").order("name", { ascending: true }),
      supabase.from("company_scoring_config").select("*"),
      getCurrentUserProfile(),
    ]);

    if (assetsError || maintenanceError || incidentsError) {
      setError(
        assetsError?.message ||
          maintenanceError?.message ||
          incidentsError?.message ||
          "Erreur de chargement dashboard."
      );
      setLoading(false);
      return;
    }

    const configMap = {};
    (scoringData || []).forEach((item) => {
      if (item.company_id) configMap[item.company_id] = item;
    });

    setAssets(assetsData || []);
    setMaintenance(maintenanceData || []);
    setIncidents(incidentsData || []);
    setOrganisations(organisationsData || []);
    setScoringConfigs(configMap);
    setUserRole(profile?.role || "");
    setLoading(false);
  }

  const periodStart = useMemo(() => getPeriodStart(selectedPeriod), [selectedPeriod]);

  const categories = useMemo(() => {
    const set = new Set();
    assets.forEach((asset) => {
      if (asset.category) set.add(asset.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const assetById = useMemo(() => {
    const map = {};
    assets.forEach((asset) => {
      map[asset.id] = asset;
    });
    return map;
  }, [assets]);

  const assetsFiltered = useMemo(() => {
    return assets.filter((asset) => {
      const companyMatch =
        selectedCompanyId === "ALL" || asset.company_id === selectedCompanyId;
      const categoryMatch =
        selectedCategory === "ALL" || asset.category === selectedCategory;
      return companyMatch && categoryMatch;
    });
  }, [assets, selectedCompanyId, selectedCategory]);

  const filteredAssetIds = useMemo(
    () => new Set(assetsFiltered.map((asset) => asset.id)),
    [assetsFiltered]
  );

  const incidentsByAssetId = useMemo(() => {
    const map = {};
    incidents.forEach((item) => {
      if (!item.asset_id) return;
      if (!map[item.asset_id]) map[item.asset_id] = [];
      map[item.asset_id].push(item);
    });
    return map;
  }, [incidents]);

  const maintenanceByAssetId = useMemo(() => {
    const map = {};
    maintenance.forEach((item) => {
      if (!item.asset_id) return;
      if (!map[item.asset_id]) map[item.asset_id] = [];
      map[item.asset_id].push(item);
    });
    return map;
  }, [maintenance]);

  const incidentsFilteredByPeriod = useMemo(() => {
    return incidents.filter((item) => {
      if (!filteredAssetIds.has(item.asset_id)) return false;
      if (!periodStart) return true;
      return toTs(item.created_at) >= periodStart.getTime();
    });
  }, [incidents, filteredAssetIds, periodStart]);

  const maintenanceFilteredByPeriod = useMemo(() => {
    return maintenance.filter((item) => {
      if (!filteredAssetIds.has(item.asset_id)) return false;
      if (!periodStart) return true;
      return toTs(item.created_at) >= periodStart.getTime();
    });
  }, [maintenance, filteredAssetIds, periodStart]);

  const activeMaintenanceBacklog = useMemo(() => {
    return maintenance.filter((item) => {
      if (!filteredAssetIds.has(item.asset_id)) return false;
      return !item.is_completed && String(item.status || "").toUpperCase() !== "TERMINEE";
    });
  }, [maintenance, filteredAssetIds]);

  const overdueMaintenance = useMemo(() => {
    const now = Date.now();
    return activeMaintenanceBacklog.filter((item) => {
      const due = toTs(item.due_date);
      return due > 0 && due < now;
    });
  }, [activeMaintenanceBacklog]);

  const assetInsights = useMemo(() => {
    return assetsFiltered.map((asset) => {
      const insight = evaluateAssetHealth({
        asset,
        incidents: incidentsByAssetId[asset.id] || [],
        maintenance: maintenanceByAssetId[asset.id] || [],
        scoringConfig: scoringConfigs[asset.company_id],
      });
      return {
        id: asset.id,
        name: asset.name || "Sans nom",
        company_id: asset.company_id,
        company_name: asset.organisations?.name || "Sans société",
        category: asset.category || "-",
        status: asset.status || "-",
        ...insight,
      };
    });
  }, [assetsFiltered, incidentsByAssetId, maintenanceByAssetId, scoringConfigs]);

  const portfolioValue = useMemo(
    () =>
      assetsFiltered.reduce(
        (sum, asset) => sum + Number(asset.purchase_value ?? asset.value ?? 0),
        0
      ),
    [assetsFiltered]
  );

  const maintenanceCostPeriod = useMemo(
    () =>
      maintenanceFilteredByPeriod.reduce(
        (sum, item) => sum + Number(item.cost || 0),
        0
      ),
    [maintenanceFilteredByPeriod]
  );

  const maintenanceVsPortfolio = useMemo(() => {
    if (!portfolioValue) return 0;
    return (maintenanceCostPeriod / portfolioValue) * 100;
  }, [portfolioValue, maintenanceCostPeriod]);

  const openIncidents = useMemo(
    () => incidentsFilteredByPeriod.filter((item) => item.status !== "RESOLU").length,
    [incidentsFilteredByPeriod]
  );

  const criticalAssetsCount = useMemo(
    () => assetInsights.filter((item) => item.score < 50).length,
    [assetInsights]
  );

  const slaLateRate = useMemo(() => {
    if (!activeMaintenanceBacklog.length) return 0;
    return (overdueMaintenance.length / activeMaintenanceBacklog.length) * 100;
  }, [activeMaintenanceBacklog, overdueMaintenance]);

  const rentableCount = useMemo(
    () => assetInsights.filter((item) => item.rentable).length,
    [assetInsights]
  );

  const nonRentableCount = useMemo(
    () => assetInsights.filter((item) => !item.rentable).length,
    [assetInsights]
  );

  const averageScore = useMemo(() => {
    if (!assetInsights.length) return 0;
    return (
      assetInsights.reduce((sum, item) => sum + Number(item.score || 0), 0) /
      assetInsights.length
    );
  }, [assetInsights]);

  const maintenanceForecastN1 = useMemo(
    () => forecastMaintenanceBudgetN1(maintenanceFilteredByPeriod),
    [maintenanceFilteredByPeriod]
  );

  const replacementCandidates = useMemo(
    () =>
      assetInsights
        .filter((item) => item.replacementRecommended)
        .sort((a, b) => a.score - b.score)
        .slice(0, 10),
    [assetInsights]
  );

  const potentialSavings = useMemo(() => {
    return replacementCandidates.reduce((sum, item) => {
      const estimate = Math.max(
        item.totalMaintenance * 0.35,
        item.totalMaintenance - item.vnc * 0.08
      );
      return sum + Math.max(0, estimate);
    }, 0);
  }, [replacementCandidates]);

  const topRisks30Days = useMemo(() => {
    return assetInsights
      .map((item) => {
        const riskScore30 =
          (100 - Number(item.score || 0)) +
          Number(item.incidentCount30d || 0) * 8 +
          Number(item.overdueMaintenanceCount || 0) * 15 +
          (item.maintenanceRatio > item.scoringConfig.replacement_ratio_threshold ? 20 : 0);
        return {
          ...item,
          riskScore30: Math.round(riskScore30),
        };
      })
      .sort((a, b) => b.riskScore30 - a.riskScore30)
      .slice(0, 12);
  }, [assetInsights]);

  const quality = useMemo(() => {
    const baseAssets = assetsFiltered;
    return {
      missingValue: baseAssets.filter(
        (asset) =>
          (asset.purchase_value === null || asset.purchase_value === undefined) &&
          (asset.value === null || asset.value === undefined)
      ).length,
      missingCompany: baseAssets.filter((asset) => !asset.company_id).length,
      missingAmortization: baseAssets.filter(
        (asset) => !asset.amortissement_type || !asset.amortissement_duration
      ).length,
      maintenanceMissingDeadline: activeMaintenanceBacklog.filter((item) => !item.due_date).length,
      incidentsMissingTitle: incidentsFilteredByPeriod.filter((item) => !item.title).length,
    };
  }, [assetsFiltered, activeMaintenanceBacklog, incidentsFilteredByPeriod]);

  const actionsOpenIncidents = useMemo(() => {
    return incidents
      .filter(
        (item) =>
          filteredAssetIds.has(item.asset_id) &&
          item.status !== "RESOLU"
      )
      .sort((a, b) => toTs(a.created_at) - toTs(b.created_at))
      .slice(0, 5)
      .map((item) => ({
        ...item,
        assetName: assetById[item.asset_id]?.name || item.assets?.name || "-",
      }));
  }, [incidents, filteredAssetIds, assetById]);

  const actionsOverdueMaintenance = useMemo(() => {
    return overdueMaintenance
      .slice()
      .sort((a, b) => toTs(a.due_date) - toTs(b.due_date))
      .slice(0, 5)
      .map((item) => ({
        ...item,
        assetName: assetById[item.asset_id]?.name || item.assets?.name || "-",
      }));
  }, [overdueMaintenance, assetById]);

  const comparisonByCompany = useMemo(() => {
    const baseAssets = assets.filter(
      (asset) => selectedCategory === "ALL" || asset.category === selectedCategory
    );
    const grouped = {};

    organisations.forEach((company) => {
      grouped[company.id] = {
        company_id: company.id,
        name: company.name,
        assetCount: 0,
        maintenanceCost: 0,
        openIncidents: 0,
        averageScore: 0,
      };
    });

    baseAssets.forEach((asset) => {
      if (selectedCompanyId !== "ALL" && asset.company_id !== selectedCompanyId) return;
      if (!grouped[asset.company_id]) {
        grouped[asset.company_id] = {
          company_id: asset.company_id,
          name: asset.organisations?.name || "Sans société",
          assetCount: 0,
          maintenanceCost: 0,
          openIncidents: 0,
          averageScore: 0,
        };
      }
      grouped[asset.company_id].assetCount += 1;
    });

    const companyAssetIds = {};
    baseAssets.forEach((asset) => {
      if (selectedCompanyId !== "ALL" && asset.company_id !== selectedCompanyId) return;
      if (!companyAssetIds[asset.company_id]) companyAssetIds[asset.company_id] = new Set();
      companyAssetIds[asset.company_id].add(asset.id);
    });

    maintenance.forEach((item) => {
      const companyId = assetById[item.asset_id]?.company_id || item.assets?.company_id;
      if (!companyId || !grouped[companyId]) return;
      if (periodStart && toTs(item.created_at) < periodStart.getTime()) return;
      grouped[companyId].maintenanceCost += Number(item.cost || 0);
    });

    incidents.forEach((item) => {
      const companyId = assetById[item.asset_id]?.company_id || item.assets?.company_id;
      if (!companyId || !grouped[companyId]) return;
      if (periodStart && toTs(item.created_at) < periodStart.getTime()) return;
      if (item.status !== "RESOLU") grouped[companyId].openIncidents += 1;
    });

    Object.values(grouped).forEach((row) => {
      const ids = companyAssetIds[row.company_id] || new Set();
      const insightRows = assetInsights.filter((item) => ids.has(item.id));
      row.averageScore = insightRows.length
        ? insightRows.reduce((sum, item) => sum + item.score, 0) / insightRows.length
        : 0;
      row.averageScore = Number(row.averageScore.toFixed(1));
    });

    return Object.values(grouped)
      .filter((row) => row.assetCount > 0)
      .sort((a, b) => b.maintenanceCost - a.maintenanceCost);
  }, [
    assets,
    organisations,
    selectedCategory,
    selectedCompanyId,
    maintenance,
    incidents,
    periodStart,
    assetById,
    assetInsights,
  ]);

  const maintenanceByAssetChart = useMemo(() => {
    return assetInsights
      .map((item) => ({
        asset_id: item.id,
        name: item.name,
        value: item.totalMaintenance,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [assetInsights]);

  const incidentStatusData = useMemo(() => {
    const open = incidentsFilteredByPeriod.filter((item) => item.status !== "RESOLU").length;
    const resolved = incidentsFilteredByPeriod.filter((item) => item.status === "RESOLU").length;
    return [
      { name: "Ouverts", value: open },
      { name: "Résolus", value: resolved },
    ];
  }, [incidentsFilteredByPeriod]);

  const amortizationByYear = useMemo(() => {
    const grouped = {};
    assetsFiltered.forEach((asset) => {
      const schedule = buildAmortizationSchedule({
        purchaseValue: Number(asset.purchase_value ?? asset.value ?? 0),
        durationYears: Number(asset.amortissement_duration ?? 0),
        purchaseDate: asset.purchase_date || asset.created_at,
        amortType: asset.amortissement_type || "LINEAIRE",
      });
      schedule.forEach((row) => {
        grouped[row.year] = (grouped[row.year] || 0) + Number(row.annual || 0);
      });
    });
    return Object.keys(grouped)
      .sort((a, b) => Number(a) - Number(b))
      .map((year) => ({ year, value: grouped[year] }));
  }, [assetsFiltered]);

  const maintenanceMonthlySeries = useMemo(() => {
    const grouped = groupMaintenanceByMonth(maintenanceFilteredByPeriod, 12);
    return appendForecast(buildMonthSeries(grouped, 12), 3);
  }, [maintenanceFilteredByPeriod]);

  const focusedAsset = useMemo(
    () => assetInsights.find((item) => item.id === focusedAssetId) || null,
    [assetInsights, focusedAssetId]
  );

  async function closeIncident(id) {
    if (!canCloseOps) return;
    setActionBusy(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: closeError } = await supabase
      .from("incidents")
      .update({
        status: "RESOLU",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id || null,
      })
      .eq("id", id);
    if (closeError) {
      setError(closeError.message);
    } else {
      await fetchData();
    }
    setActionBusy(false);
  }

  async function closeMaintenance(id) {
    if (!canCloseOps) return;
    setActionBusy(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: closeError } = await supabase
      .from("maintenance")
      .update({
        is_completed: true,
        status: "TERMINEE",
        completed_at: new Date().toISOString(),
        completed_by: user?.id || null,
      })
      .eq("id", id);
    if (closeError) {
      setError(closeError.message);
    } else {
      await fetchData();
    }
    setActionBusy(false);
  }

  function exportCsv() {
    const headers = [
      "Actif",
      "Société",
      "Score",
      "Risque_30j",
      "Incidents_30j",
      "Maintenance_retard",
      "Ratio_maintenance",
      "Recommendation",
    ];
    const rows = topRisks30Days.map((item) => [
      item.name,
      item.company_name,
      item.score,
      item.riskScore30,
      item.incidentCount30d,
      item.overdueMaintenanceCount,
      item.maintenanceRatio.toFixed(2),
      item.recommendation,
    ]);
    const csv = [headers, ...rows]
      .map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard_risques_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1200,height=900");
    if (!popup) return;

    const html = `
      <!doctype html>
      <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>Dashboard Executif</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1, h2 { margin: 0 0 12px 0; }
          .kpi { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
          .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
          th { background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>Dashboard CFO & Predictif</h1>
        <div class="kpi">
          <div class="box"><strong>Actifs</strong><br/>${assetsFiltered.length}</div>
          <div class="box"><strong>Valeur portefeuille</strong><br/>${formatEUR(portfolioValue)}</div>
          <div class="box"><strong>Maintenance / Valeur</strong><br/>${maintenanceVsPortfolio.toFixed(1)}%</div>
          <div class="box"><strong>Incidents ouverts</strong><br/>${openIncidents}</div>
          <div class="box"><strong>SLA en retard</strong><br/>${slaLateRate.toFixed(1)}%</div>
          <div class="box"><strong>Score moyen</strong><br/>${averageScore.toFixed(1)}/100</div>
        </div>
        <h2>Top risques 30 jours</h2>
        <table>
          <thead>
            <tr><th>Actif</th><th>Société</th><th>Score</th><th>Risque 30j</th><th>Décision</th></tr>
          </thead>
          <tbody>
            ${topRisks30Days
              .slice(0, 12)
              .map(
                (item) =>
                  `<tr><td>${item.name}</td><td>${item.company_name}</td><td>${item.score}</td><td>${item.riskScore30}</td><td>${item.recommendation}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </body>
      </html>
    `;
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  if (loading) {
    return (
      <Layout>
        <h1>Dashboard CFO & Predictif</h1>
        <p>Chargement des indicateurs...</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="dashboard-header-row">
        <div>
          <h1>Dashboard CFO & Predictif</h1>
          <p className="dashboard-hero">
            Pilotage groupe: coûts, risques, rentabilité, SLA et décisions opérationnelles.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn-primary" onClick={exportPdf}>
            Export PDF
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Filtres globaux</h3>
        <div className="dashboard-filter-grid">
          <select
            className="select"
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
          >
            <option value="ALL">Toutes les sociétés</option>
            {organisations.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Période: {option.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="ALL">Toutes catégories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="dashboard-grid">
        <div className="card kpi-solid">
          <h3>Valeur portefeuille</h3>
          <p>{formatEUR(portfolioValue)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Coût maintenance (période)</h3>
          <p>{formatEUR(maintenanceCostPeriod)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Maintenance / Valeur</h3>
          <p>{maintenanceVsPortfolio.toFixed(1)}%</p>
        </div>
        <div className="card">
          <h3>Économies potentielles</h3>
          <p>{formatEUR(potentialSavings)}</p>
        </div>
        <div className="card">
          <h3>Actifs critiques (score &lt; 50)</h3>
          <p>{criticalAssetsCount}</p>
        </div>
        <div className="card">
          <h3>SLA en retard</h3>
          <p>{slaLateRate.toFixed(1)}%</p>
        </div>
        <div className="card">
          <h3>Incidents ouverts</h3>
          <p>{openIncidents}</p>
        </div>
        <div className="card">
          <h3>Budget maintenance N+1</h3>
          <p>{formatEUR(maintenanceForecastN1)}</p>
        </div>
        <div className="card">
          <h3>Actifs rentables / non rentables</h3>
          <p>{rentableCount} / {nonRentableCount}</p>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Comparatif sociétés (coût, incidents, score)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={comparisonByCompany}
              onClick={(state) => {
                const row = state?.activePayload?.[0]?.payload;
                if (row?.company_id) setSelectedCompanyId(row.company_id);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value, name) => {
                if (name === "maintenanceCost") return formatEUR(value);
                return value;
              }} />
              <Legend />
              <Bar dataKey="maintenanceCost" fill="#0b3d91" name="Coût maintenance" />
              <Bar dataKey="openIncidents" fill="#dc2626" name="Incidents ouverts" />
              <Bar dataKey="averageScore" fill="#0a8f87" name="Score moyen" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Répartition incidents</h3>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={incidentStatusData} dataKey="value" outerRadius={110}>
                {incidentStatusData.map((item, index) => (
                  <Cell key={item.name} fill={index === 0 ? "#dc2626" : "#0a8f87"} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Tendance maintenance + prévision 3 mois</h3>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={maintenanceMonthlySeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => (value == null ? "-" : formatEUR(value))} />
              <Legend />
              <Line type="monotone" dataKey="value" stroke="#0b3d91" name="Réel" strokeWidth={3} />
              <Line type="monotone" dataKey="forecast" stroke="#f59e0b" name="Prévision" strokeDasharray="5 5" />
              <Area type="monotone" dataKey="forecastUpper" fill="#fde68a" stroke="#f59e0b" name="Borne haute" />
              <Area type="monotone" dataKey="forecastLower" fill="#fef3c7" stroke="#d97706" name="Borne basse" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Top coût maintenance par actif (drill-down)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={maintenanceByAssetChart}
              onClick={(state) => {
                const row = state?.activePayload?.[0]?.payload;
                if (row?.asset_id) setFocusedAssetId(row.asset_id);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => formatEUR(value)} />
              <Bar dataKey="value" fill="#1e40af" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {!secondaryReady ? (
        <div className="card">
          <p>Chargement des analyses détaillées...</p>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>Actions immédiates</h3>
            <div className="chart-grid">
              <div>
                <h4 style={{ marginBottom: 8 }}>Incidents ouverts les plus anciens</h4>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Actif</th>
                      <th>Incident</th>
                      <th>Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionsOpenIncidents.map((item) => (
                      <tr key={`incident-action-${item.id}`}>
                        <td>
                          {item.asset_id ? (
                            <Link className="dashboard-link" href={`/assets/${item.asset_id}`}>
                              {item.assetName}
                            </Link>
                          ) : (
                            item.assetName
                          )}
                        </td>
                        <td>{item.title || "-"}</td>
                        <td>{new Date(item.created_at).toLocaleDateString("fr-FR")}</td>
                        <td style={{ display: "flex", gap: 8 }}>
                          <button
                            className="btn-secondary"
                            onClick={() => router.push(`/assets/${item.asset_id}`)}
                          >
                            Voir actif
                          </button>
                          {canCloseOps && (
                            <button
                              className="btn-success"
                              disabled={actionBusy}
                              onClick={() => closeIncident(item.id)}
                            >
                              Clôturer
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {actionsOpenIncidents.length === 0 && (
                      <tr>
                        <td colSpan={4}>Aucun incident ouvert.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 style={{ marginBottom: 8 }}>Maintenances en retard</h4>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Actif</th>
                      <th>Maintenance</th>
                      <th>Deadline</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionsOverdueMaintenance.map((item) => (
                      <tr key={`maintenance-action-${item.id}`}>
                        <td>
                          {item.asset_id ? (
                            <Link className="dashboard-link" href={`/assets/${item.asset_id}`}>
                              {item.assetName}
                            </Link>
                          ) : (
                            item.assetName
                          )}
                        </td>
                        <td>{item.title || "-"}</td>
                        <td>{item.due_date ? new Date(item.due_date).toLocaleDateString("fr-FR") : "-"}</td>
                        <td style={{ display: "flex", gap: 8 }}>
                          <button
                            className="btn-secondary"
                            onClick={() => router.push(`/assets/${item.asset_id}`)}
                          >
                            Voir actif
                          </button>
                          {canCloseOps && (
                            <button
                              className="btn-success"
                              disabled={actionBusy}
                              onClick={() => closeMaintenance(item.id)}
                            >
                              Clôturer
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {actionsOverdueMaintenance.length === 0 && (
                      <tr>
                        <td colSpan={4}>Aucune maintenance en retard.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Top risques 30 jours</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Actif</th>
                  <th>Société</th>
                  <th>Score</th>
                  <th>Risque 30j</th>
                  <th>Incidents 30j</th>
                  <th>Maintenances en retard</th>
                  <th>Décision</th>
                </tr>
              </thead>
              <tbody>
                {topRisks30Days.map((item) => (
                  <tr key={`risk-${item.id}`} onClick={() => setFocusedAssetId(item.id)}>
                    <td>
                      <Link
                        className="dashboard-link"
                        href={`/assets/${item.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td>{item.company_name}</td>
                    <td>{item.score}/100</td>
                    <td>{item.riskScore30}</td>
                    <td>{item.incidentCount30d}</td>
                    <td>{item.overdueMaintenanceCount}</td>
                    <td>{item.recommendation}</td>
                  </tr>
                ))}
                {topRisks30Days.length === 0 && (
                  <tr>
                    <td colSpan={7}>Aucune donnée de risque.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Explication score actif</h3>
            {focusedAsset ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Actif</th>
                    <th>Penalty maintenance</th>
                    <th>Penalty incidents</th>
                    <th>Penalty VNC</th>
                    <th>Penalty SLA</th>
                    <th>Score final</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{focusedAsset.name}</td>
                    <td>{focusedAsset.scoreBreakdown.maintenancePenalty}</td>
                    <td>{focusedAsset.scoreBreakdown.incidentPenalty}</td>
                    <td>{focusedAsset.scoreBreakdown.vncPenalty}</td>
                    <td>{focusedAsset.scoreBreakdown.slaPenalty}</td>
                    <td>{focusedAsset.score}/100</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p>Clique sur un actif dans les graphes/tables pour afficher le détail de score.</p>
            )}
          </div>

          <div className="card">
            <h3>Qualité de données</h3>
            <div className="dashboard-grid">
              <div className="card">
                <h3>Actifs sans valeur</h3>
                <p>{quality.missingValue}</p>
              </div>
              <div className="card">
                <h3>Actifs sans société</h3>
                <p>{quality.missingCompany}</p>
              </div>
              <div className="card">
                <h3>Amortissement incomplet</h3>
                <p>{quality.missingAmortization}</p>
              </div>
              <div className="card">
                <h3>Maintenances sans deadline</h3>
                <p>{quality.maintenanceMissingDeadline}</p>
              </div>
              <div className="card">
                <h3>Incidents sans titre</h3>
                <p>{quality.incidentsMissingTitle}</p>
              </div>
              <div className="card">
                <h3>Score moyen parc</h3>
                <p>{averageScore.toFixed(1)}/100</p>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <h3>Amortissement annuel consolidé</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={amortizationByYear}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis />
            <Tooltip formatter={(value) => formatEUR(value)} />
            <Legend />
            <Line type="monotone" dataKey="value" stroke="#0a8f87" strokeWidth={3} name="Dotation" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Layout>
  );
}
