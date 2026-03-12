import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Layout from "../../components/Layout";
import StatusBadge from "../../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { formatMGA } from "../../lib/currency";
import { getCurrentUserProfile } from "../../lib/accessControl";
import {
  aggregateReplacementPortfolio,
  simulateReplacementPlan,
} from "../../lib/replacementPlanner";

const FILTER_OPTIONS = [
  { value: "CANDIDATES", label: "Candidats remplacement" },
  { value: "REBUS", label: "Actifs rebus" },
  { value: "RECOMMENDED", label: "Remplacement recommandé" },
  { value: "ALL", label: "Tous les actifs" },
];

function normalizeNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPayback(value) {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(1)} ans`;
}

function sanitizeCsvCell(value) {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(";") || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export default function ReplacementPlanPage() {
  const router = useRouter();
  const preselectedAssetId = Array.isArray(router.query.asset_id)
    ? router.query.asset_id[0]
    : router.query.asset_id || "";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [userRole, setUserRole] = useState("");
  const [organisations, setOrganisations] = useState([]);
  const [assets, setAssets] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [scoringConfigs, setScoringConfigs] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("ALL");
  const [candidateFilter, setCandidateFilter] = useState("CANDIDATES");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [scenario, setScenario] = useState({
    replacementCapex: "",
    annualNewAssetOpex: "",
    horizonYears: "",
    oldAssetOpexGrowthRate: "",
    salvageRecovery: "",
  });

  useEffect(() => {
    fetchData();
  }, [selectedCompanyId]);

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

  const scoringConfigByCompanyId = useMemo(() => {
    const map = {};
    scoringConfigs.forEach((item) => {
      if (item?.company_id) {
        map[item.company_id] = item;
      }
    });
    return map;
  }, [scoringConfigs]);

  const replacementPlans = useMemo(() => {
    return (assets || [])
      .map((asset) =>
        simulateReplacementPlan({
          asset,
          incidents: incidentsByAssetId[asset.id] || [],
          maintenance: maintenanceByAssetId[asset.id] || [],
          scoringConfig: scoringConfigByCompanyId[asset.company_id] || null,
        })
      )
      .sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) {
          return b.priorityScore - a.priorityScore;
        }
        return b.roiPct - a.roiPct;
      });
  }, [assets, incidentsByAssetId, maintenanceByAssetId, scoringConfigByCompanyId]);

  const filteredPlans = useMemo(() => {
    return replacementPlans.filter((item) => {
      const isRebus = String(item.asset?.status || "").toUpperCase() === "REBUS";
      if (candidateFilter === "REBUS") return isRebus;
      if (candidateFilter === "RECOMMENDED") return item.health.replacementRecommended;
      if (candidateFilter === "CANDIDATES") return item.isCandidate;
      return true;
    });
  }, [replacementPlans, candidateFilter]);

  const selectedPlanBase = useMemo(() => {
    return filteredPlans.find((item) => item.asset.id === selectedAssetId) || null;
  }, [filteredPlans, selectedAssetId]);

  const scenarioPlan = useMemo(() => {
    if (!selectedPlanBase) return null;
    return simulateReplacementPlan({
      asset: selectedPlanBase.asset,
      incidents: incidentsByAssetId[selectedPlanBase.asset.id] || [],
      maintenance: maintenanceByAssetId[selectedPlanBase.asset.id] || [],
      scoringConfig: scoringConfigByCompanyId[selectedPlanBase.asset.company_id] || null,
      overrides: {
        replacementCapex: parseOptionalNumber(scenario.replacementCapex),
        annualNewAssetOpex: parseOptionalNumber(scenario.annualNewAssetOpex),
        horizonYears: parseOptionalNumber(scenario.horizonYears),
        oldAssetOpexGrowthRate: parseOptionalNumber(scenario.oldAssetOpexGrowthRate),
        salvageRecovery: parseOptionalNumber(scenario.salvageRecovery),
      },
    });
  }, [
    selectedPlanBase,
    incidentsByAssetId,
    maintenanceByAssetId,
    scoringConfigByCompanyId,
    scenario,
  ]);

  const portfolioSummary = useMemo(
    () => aggregateReplacementPortfolio(filteredPlans),
    [filteredPlans]
  );

  const roiChartData = useMemo(() => {
    return filteredPlans.slice(0, 8).map((item, index) => ({
      label: `${index + 1}. ${item.asset.name}`,
      roiPct: item.roiPct,
      capex: item.replacementCapex,
      keepCost: item.keepTotalCost,
      replaceCost: item.replaceTotalCost,
    }));
  }, [filteredPlans]);

  useEffect(() => {
    if (!filteredPlans.length) {
      setSelectedAssetId("");
      return;
    }

    if (
      preselectedAssetId &&
      filteredPlans.some((item) => item.asset.id === preselectedAssetId)
    ) {
      setSelectedAssetId(preselectedAssetId);
      return;
    }

    if (!filteredPlans.some((item) => item.asset.id === selectedAssetId)) {
      setSelectedAssetId(filteredPlans[0].asset.id);
    }
  }, [filteredPlans, selectedAssetId, preselectedAssetId]);

  useEffect(() => {
    if (!selectedPlanBase) {
      setScenario({
        replacementCapex: "",
        annualNewAssetOpex: "",
        horizonYears: "",
        oldAssetOpexGrowthRate: "",
        salvageRecovery: "",
      });
      return;
    }

    setScenario({
      replacementCapex: String(selectedPlanBase.replacementCapex || 0),
      annualNewAssetOpex: String(selectedPlanBase.annualNewAssetOpex || 0),
      horizonYears: String(selectedPlanBase.horizonYears || 1),
      oldAssetOpexGrowthRate: String(selectedPlanBase.annualGrowthRate || 0),
      salvageRecovery: String(selectedPlanBase.salvageRecovery || 0),
    });
  }, [selectedPlanBase?.asset?.id]);

  async function fetchData() {
    const isInitial = loading;
    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError("");

    const [{ data: orgs }, { profile }, { data: scoringData, error: scoringError }] =
      await Promise.all([
        supabase.from("organisations").select("id, name").order("name", { ascending: true }),
        getCurrentUserProfile(),
        supabase.from("company_scoring_config").select("*").order("company_id", { ascending: true }),
      ]);

    if (scoringError) {
      setError(scoringError.message);
    }

    setOrganisations(orgs || []);
    setUserRole(profile?.role || "");

    let assetsQuery = supabase
      .from("assets")
      .select("*, organisations(name)")
      .order("created_at", { ascending: false });

    if (selectedCompanyId !== "ALL") {
      assetsQuery = assetsQuery.eq("company_id", selectedCompanyId);
    }

    const { data: assetsData, error: assetsError } = await assetsQuery;

    if (assetsError) {
      setError(assetsError.message);
      setAssets([]);
      setIncidents([]);
      setMaintenance([]);
      setScoringConfigs(scoringData || []);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const assetIds = (assetsData || []).map((item) => item.id).filter(Boolean);
    let incidentsData = [];
    let maintenanceData = [];

    if (assetIds.length) {
      const [incidentsResponse, maintenanceResponse] = await Promise.all([
        supabase
          .from("incidents")
          .select("*")
          .in("asset_id", assetIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("maintenance")
          .select("*")
          .in("asset_id", assetIds)
          .order("created_at", { ascending: false }),
      ]);

      if (incidentsResponse.error) {
        setError(incidentsResponse.error.message);
      } else {
        incidentsData = incidentsResponse.data || [];
      }

      if (maintenanceResponse.error) {
        setError(maintenanceResponse.error.message);
      } else {
        maintenanceData = maintenanceResponse.data || [];
      }
    }

    setAssets(assetsData || []);
    setIncidents(incidentsData);
    setMaintenance(maintenanceData);
    setScoringConfigs(scoringData || []);
    setLoading(false);
    setRefreshing(false);
  }

  function exportCsv() {
    const headers = [
      "Actif",
      "Société",
      "Statut",
      "Priorité",
      "Score",
      "Recommendation",
      "OPEX_conserver",
      "CAPEX_remplacement",
      "OPEX_remplacement",
      "Cout_total_conserver",
      "Cout_total_remplacer",
      "Gain_net",
      "ROI_pct",
      "Payback_annees",
    ];

    const rows = filteredPlans.map((item) => [
      item.asset.name,
      item.asset.organisations?.name || "-",
      item.asset.status || "-",
      item.priorityLabel,
      item.health.score,
      item.health.recommendation,
      item.annualCurrentOpex,
      item.replacementCapex,
      item.annualNewAssetOpex,
      item.keepTotalCost,
      item.replaceTotalCost,
      item.netSavings,
      item.roiPct,
      item.paybackYears ?? "",
    ]);

    const csv = [headers, ...rows]
      .map((line) => line.map(sanitizeCsvCell).join(";"))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plan_remplacement_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <Layout>
        <h1>Plan de remplacement</h1>
        <p>Chargement des simulations...</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="dashboard-header-row">
        <div>
          <h1>Plan de remplacement</h1>
          <p className="page-subtitle">
            Simulation CAPEX/OPEX/ROI par actif et vue portefeuille.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn-primary" onClick={() => fetchData()}>
            {refreshing ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
      </div>

      <div className="alert-warning" style={{ marginBottom: 16 }}>
        Les hypothèses par défaut viennent de la configuration société. La simulation détaillée
        peut ensuite être ajustée actif par actif.
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
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
            value={candidateFilter}
            onChange={(e) => setCandidateFilter(e.target.value)}
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="card" style={{ margin: 0, padding: "10px 14px" }}>
            <strong>Rôle connecté:</strong> {userRole || "-"}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card kpi-solid">
          <h3>Candidats</h3>
          <p>{portfolioSummary.candidateCount}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Urgents</h3>
          <p>{portfolioSummary.urgentCount}</p>
        </div>
        <div className="card kpi-solid">
          <h3>CAPEX simulé</h3>
          <p>{formatMGA(portfolioSummary.totalCapex)}</p>
        </div>
        <div className="card">
          <h3>Coût si on conserve</h3>
          <p>{formatMGA(portfolioSummary.totalKeepCost)}</p>
        </div>
        <div className="card">
          <h3>Coût si on remplace</h3>
          <p>{formatMGA(portfolioSummary.totalReplaceCost)}</p>
        </div>
        <div className="card">
          <h3>Gain net simulé</h3>
          <p>{formatMGA(portfolioSummary.totalNetSavings)}</p>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Top ROI remplacement</h3>
          {roiChartData.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={roiChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" hide />
                <YAxis />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "CAPEX") return [formatMGA(value), name];
                    if (name === "Coût conserver") return [formatMGA(value), name];
                    if (name === "Coût remplacer") return [formatMGA(value), name];
                    return [`${value}%`, name];
                  }}
                />
                <Legend />
                <Bar dataKey="roiPct" fill="#0a8f87" name="ROI %" />
                <Bar dataKey="capex" fill="#0b3d91" name="CAPEX" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p>Aucun actif correspondant à ce filtre.</p>
          )}
        </div>

        <div className="card">
          <h3>Comparatif coûts conserver vs remplacer</h3>
          {roiChartData.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={roiChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" hide />
                <YAxis />
                <Tooltip formatter={(value) => formatMGA(value)} />
                <Legend />
                <Bar dataKey="keepCost" fill="#dc2626" name="Coût conserver" />
                <Bar dataKey="replaceCost" fill="#0a8f87" name="Coût remplacer" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p>Aucun actif correspondant à ce filtre.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Liste des actifs à arbitrer / remplacer</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Actif</th>
              <th>Société</th>
              <th>Statut</th>
              <th>Priorité</th>
              <th>Score</th>
              <th>OPEX annuel actuel</th>
              <th>CAPEX estimé</th>
              <th>ROI</th>
              <th>Payback</th>
              <th>Décision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlans.map((item) => (
              <tr key={item.asset.id}>
                <td>
                  <Link className="dashboard-link" href={`/assets/${item.asset.id}`}>
                    {item.asset.name || "-"}
                  </Link>
                </td>
                <td>{item.asset.organisations?.name || "-"}</td>
                <td><StatusBadge status={item.asset.status} /></td>
                <td>{item.priorityLabel}</td>
                <td>{item.health.score}/100</td>
                <td>{formatMGA(item.annualCurrentOpex)}</td>
                <td>{formatMGA(item.replacementCapex)}</td>
                <td>{item.roiPct.toFixed(1)}%</td>
                <td>{formatPayback(item.paybackYears)}</td>
                <td>{item.health.recommendation}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-secondary"
                    onClick={() => setSelectedAssetId(item.asset.id)}
                  >
                    Simuler
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => router.push(`/assets/${item.asset.id}`)}
                  >
                    Voir actif
                  </button>
                </td>
              </tr>
            ))}
            {filteredPlans.length === 0 && (
              <tr>
                <td colSpan={11}>Aucun actif à afficher pour ce filtre.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card replacement-simulation-card">
        <h3>Simulation détaillée</h3>
        {selectedPlanBase && scenarioPlan ? (
          <>
            <p style={{ marginBottom: 12 }}>
              <strong>{selectedPlanBase.asset.name}</strong>
              {" · "}
              {selectedPlanBase.asset.organisations?.name || "-"}
            </p>

            <div className="form-grid" style={{ marginBottom: 16 }}>
              <div className="form-field">
                <label>CAPEX remplacement</label>
                <input
                  className="input"
                  type="number"
                  value={scenario.replacementCapex}
                  onChange={(e) =>
                    setScenario((prev) => ({ ...prev, replacementCapex: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>OPEX annuel nouvel actif</label>
                <input
                  className="input"
                  type="number"
                  value={scenario.annualNewAssetOpex}
                  onChange={(e) =>
                    setScenario((prev) => ({ ...prev, annualNewAssetOpex: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>Horizon (années)</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={scenario.horizonYears}
                  onChange={(e) =>
                    setScenario((prev) => ({ ...prev, horizonYears: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>Croissance OPEX actif existant (%)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={scenario.oldAssetOpexGrowthRate}
                  onChange={(e) =>
                    setScenario((prev) => ({
                      ...prev,
                      oldAssetOpexGrowthRate: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-field">
                <label>Valeur de récupération</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={scenario.salvageRecovery}
                  onChange={(e) =>
                    setScenario((prev) => ({ ...prev, salvageRecovery: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="dashboard-grid" style={{ marginBottom: 12 }}>
              <div className="card kpi-solid">
                <h3>CAPEX net</h3>
                <p>{formatMGA(scenarioPlan.netCapex)}</p>
              </div>
              <div className="card">
                <h3>Coût conserver</h3>
                <p>{formatMGA(scenarioPlan.keepTotalCost)}</p>
              </div>
              <div className="card">
                <h3>Coût remplacer</h3>
                <p>{formatMGA(scenarioPlan.replaceTotalCost)}</p>
              </div>
              <div className="card">
                <h3>Gain net</h3>
                <p>{formatMGA(scenarioPlan.netSavings)}</p>
              </div>
              <div className="card">
                <h3>ROI</h3>
                <p>{scenarioPlan.roiPct.toFixed(1)}%</p>
              </div>
              <div className="card">
                <h3>Payback</h3>
                <p>{formatPayback(scenarioPlan.paybackYears)}</p>
              </div>
            </div>

            <div className="replacement-simulation-chart">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={scenarioPlan.projection}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatMGA(value)} />
                  <Legend />
                  <Line type="monotone" dataKey="keepCumulative" stroke="#dc2626" strokeWidth={3} name="Cumul conserver" />
                  <Line type="monotone" dataKey="replaceCumulative" stroke="#0a8f87" strokeWidth={3} name="Cumul remplacer" />
                  <Line type="monotone" dataKey="cumulativeSavings" stroke="#0b3d91" strokeWidth={2} name="Gain cumulé" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="replacement-projection-wrap">
              <table className="table replacement-projection-table" style={{ marginTop: 16 }}>
                <thead>
                  <tr>
                    <th>Année</th>
                    <th>Conserver</th>
                    <th>Remplacer CAPEX</th>
                    <th>Remplacer OPEX</th>
                    <th>Total remplacer</th>
                    <th>Gain cumulé</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioPlan.projection.map((row) => (
                    <tr key={row.yearIndex}>
                      <td>{row.label}</td>
                      <td>{formatMGA(row.keepAnnual)}</td>
                      <td>{formatMGA(row.replaceAnnualCapex)}</td>
                      <td>{formatMGA(row.replaceAnnualOpex)}</td>
                      <td>{formatMGA(row.replaceAnnualTotal)}</td>
                      <td>{formatMGA(row.cumulativeSavings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Sélectionne un actif dans la liste pour lancer la simulation détaillée.</p>
        )}
      </div>
    </Layout>
  );
}
