import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import { formatMGA } from "../../lib/currency";

const PERIOD_OPTIONS = [
  { value: "30D", label: "30 jours" },
  { value: "90D", label: "90 jours" },
  { value: "YTD", label: "Depuis Janvier" },
  { value: "12M", label: "12 mois" },
  { value: "ALL", label: "Tout" },
];

const RISK_PAGE_SIZE = 12;

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR");
}

function normalizeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeCsvCell(value) {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(";") || raw.includes("\n")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export default function Dashboard() {
  const router = useRouter();

  const [organisations, setOrganisations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [topRisksChart, setTopRisksChart] = useState([]);
  const [actionsInsuranceExpiring, setActionsInsuranceExpiring] = useState([]);
  const [insuranceActionsError, setInsuranceActionsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [userRole, setUserRole] = useState("");

  const [selectedCompanyId, setSelectedCompanyId] = useState("ALL");
  const [selectedPeriod, setSelectedPeriod] = useState("12M");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [riskPage, setRiskPage] = useState(1);

  const canCloseOps = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.RESPONSABLE_MAINTENANCE,
  ]);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!contextReady) return;
    setRiskPage(1);
  }, [selectedCompanyId, selectedPeriod, selectedCategory, contextReady]);

  useEffect(() => {
    if (!contextReady) return;
    fetchCategories();
  }, [selectedCompanyId, contextReady]);

  useEffect(() => {
    if (!contextReady) return;
    fetchSummary();
  }, [selectedCompanyId, selectedPeriod, selectedCategory, riskPage, contextReady]);

  async function bootstrap() {
    setLoading(true);
    setError("");

    const [{ data: orgs, error: orgError }, { profile }] = await Promise.all([
      supabase.from("organisations").select("id,name").order("name", { ascending: true }),
      getCurrentUserProfile(),
    ]);

    if (orgError) {
      setError(orgError.message);
    }

    setOrganisations(orgs || []);
    setUserRole(profile?.role || "");
    setContextReady(true);
    setLoading(false);
  }

  async function fetchCategories() {
    const { data, error: rpcError } = await supabase.rpc("list_asset_categories", {
      p_company_id: selectedCompanyId === "ALL" ? null : selectedCompanyId,
    });

    let items = [];
    if (!rpcError) {
      items = (data || []).map((row) => row.category).filter(Boolean);
    } else {
      let fallbackQuery = supabase
        .from("assets")
        .select("category")
        .limit(500)
        .order("category", { ascending: true });
      if (selectedCompanyId !== "ALL") {
        fallbackQuery = fallbackQuery.eq("company_id", selectedCompanyId);
      }
      const { data: fallback } = await fallbackQuery;
      items = Array.from(new Set((fallback || []).map((row) => row.category).filter(Boolean)));
    }

    setCategories(items);
    if (selectedCategory !== "ALL" && !items.includes(selectedCategory)) {
      setSelectedCategory("ALL");
    }
  }

  async function fetchSummary() {
    setSummaryLoading(true);
    setError("");
    setInsuranceActionsError("");

    const commonPayload = {
      p_company_id: selectedCompanyId === "ALL" ? null : selectedCompanyId,
      p_category: selectedCategory === "ALL" ? null : selectedCategory,
      p_period: selectedPeriod,
    };

    const [summaryResponse, top10Response, insuranceResponse] = await Promise.all([
      supabase.rpc("dashboard_summary", {
        ...commonPayload,
        p_risk_page: riskPage,
        p_risk_page_size: RISK_PAGE_SIZE,
      }),
      supabase.rpc("dashboard_summary", {
        ...commonPayload,
        p_risk_page: 1,
        p_risk_page_size: 10,
      }),
      supabase.rpc("dashboard_insurance_expiring_2w", {
        p_company_id: commonPayload.p_company_id,
        p_category: commonPayload.p_category,
        p_limit: 8,
      }),
    ]);

    const { data, error: rpcError } = summaryResponse;

    if (rpcError) {
      setError(rpcError.message);
      setSummary(null);
      setTopRisksChart([]);
      setActionsInsuranceExpiring([]);
      setSummaryLoading(false);
      return;
    }

    setSummary(data || {});
    const top10Rows = !top10Response.error
      ? top10Response.data?.top_risks || []
      : (data?.top_risks || []).slice(0, 10);
    setTopRisksChart(top10Rows);

    if (insuranceResponse.error) {
      setActionsInsuranceExpiring([]);
      setInsuranceActionsError(insuranceResponse.error.message || "Erreur chargement assurances.");
    } else {
      setActionsInsuranceExpiring(insuranceResponse.data || []);
    }

    setSummaryLoading(false);
  }

  const kpis = summary?.kpis || {};
  const quality = summary?.quality || {};
  const topRisks = summary?.top_risks || [];
  const topRisksTotal = normalizeNumber(summary?.top_risks_total);
  const topRiskTotalPages = Math.max(1, Math.ceil(topRisksTotal / RISK_PAGE_SIZE));
  const companyComparison = summary?.company_comparison || [];
  const maintenanceMonthly = summary?.maintenance_monthly || [];
  const amortizationMonthly = summary?.amortization_monthly || [];
  const amortizationKpis = summary?.amortization_kpis || {};
  const actionsOpenIncidents = summary?.actions_open_incidents || [];
  const actionsOverdueMaintenance = summary?.actions_overdue_maintenance || [];

  const topRisksChartData = useMemo(() => {
    return (topRisksChart || []).slice(0, 10).map((item, index) => {
      const fullName = String(item?.name || "-");
      const shortName = fullName.length > 24 ? `${fullName.slice(0, 24)}...` : fullName;
      return {
        rank: index + 1,
        label: `${index + 1}. ${shortName}`,
        full_name: fullName,
        company_name: item?.company_name || "-",
        risk_score_30d: normalizeNumber(item?.risk_score_30d),
        incident_count_30d: normalizeNumber(item?.incident_count_30d),
        overdue_maintenance_count: normalizeNumber(item?.overdue_maintenance_count),
      };
    });
  }, [topRisksChart]);

  const amortizationChartData = useMemo(() => {
    const monthLabels = {
      "01": "Jan",
      "02": "Fev",
      "03": "Mar",
      "04": "Avr",
      "05": "Mai",
      "06": "Jun",
      "07": "Jul",
      "08": "Aou",
      "09": "Sep",
      "10": "Oct",
      "11": "Nov",
      "12": "Dec",
    };
    return (amortizationMonthly || []).map((item) => {
      const month = String(item?.month || "");
      const monthNumber = month.slice(5, 7);
      return {
        month,
        month_label: monthLabels[monthNumber] || month,
        amortized: normalizeNumber(item?.amortized),
        cumulative: normalizeNumber(item?.cumulative),
        target_cumulative: normalizeNumber(item?.target_cumulative),
      };
    });
  }, [amortizationMonthly]);

  const portfolioValue = normalizeNumber(kpis.portfolio_value);
  const maintenanceCostPeriod = normalizeNumber(kpis.maintenance_cost_period);
  const maintenanceVsPortfolio = portfolioValue
    ? (maintenanceCostPeriod / portfolioValue) * 100
    : 0;
  const amortizedYtd = normalizeNumber(amortizationKpis.amortized_ytd);
  const amortizationAnnualTarget = normalizeNumber(amortizationKpis.annual_target);
  const amortizationRemaining = normalizeNumber(amortizationKpis.remaining);
  const amortizationCoverageRate = normalizeNumber(amortizationKpis.coverage_rate);

  const incidentStatusData = useMemo(
    () => [
      { name: "Ouverts", value: normalizeNumber(kpis.open_incidents) },
      { name: "Résolus", value: normalizeNumber(kpis.resolved_incidents) },
    ],
    [kpis.open_incidents, kpis.resolved_incidents]
  );

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

    const rows = topRisks.map((item) => [
      item.name,
      item.company_name,
      normalizeNumber(item.score).toFixed(1),
      normalizeNumber(item.risk_score_30d),
      normalizeNumber(item.incident_count_30d),
      normalizeNumber(item.overdue_maintenance_count),
      normalizeNumber(item.maintenance_ratio).toFixed(2),
      item.recommendation,
    ]);

    const csv = [headers, ...rows]
      .map((line) => line.map(sanitizeCsvCell).join(";"))
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
        <title>Dashboard Exécutif</title>
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
          <div class="box"><strong>Actifs</strong><br/>${normalizeNumber(kpis.assets_count)}</div>
          <div class="box"><strong>Valeur portefeuille</strong><br/>${escapeHtml(formatMGA(portfolioValue))}</div>
          <div class="box"><strong>Maintenance / Valeur</strong><br/>${maintenanceVsPortfolio.toFixed(1)}%</div>
          <div class="box"><strong>Incidents ouverts</strong><br/>${normalizeNumber(kpis.open_incidents)}</div>
          <div class="box"><strong>SLA en retard</strong><br/>${normalizeNumber(kpis.sla_late_rate).toFixed(1)}%</div>
          <div class="box"><strong>Score moyen</strong><br/>${normalizeNumber(kpis.average_score).toFixed(1)}/100</div>
        </div>
        <h2>Top risques 30 jours</h2>
        <table>
          <thead>
            <tr><th>Actif</th><th>Société</th><th>Score</th><th>Risque 30j</th><th>Décision</th></tr>
          </thead>
          <tbody>
            ${topRisks
              .map(
                (item) =>
                  `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(
                    item.company_name
                  )}</td><td>${normalizeNumber(item.score).toFixed(1)}</td><td>${normalizeNumber(
                    item.risk_score_30d
                  )}</td><td>${escapeHtml(item.recommendation)}</td></tr>`
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
      await fetchSummary();
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
      await fetchSummary();
    }

    setActionBusy(false);
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

      {summaryLoading && <div className="card"><p>Actualisation des données...</p></div>}
      {error && <div className="alert-error">{error}</div>}

      <div className="dashboard-grid">
        <div className="card kpi-solid">
          <h3>Valeur portefeuille</h3>
          <p>{formatMGA(portfolioValue)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Coût maintenance (période)</h3>
          <p>{formatMGA(maintenanceCostPeriod)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Maintenance / Valeur</h3>
          <p>{maintenanceVsPortfolio.toFixed(1)}%</p>
        </div>
        <div className="card">
          <h3>Actifs</h3>
          <p>{normalizeNumber(kpis.assets_count)}</p>
        </div>
        <div className="card">
          <h3>Incidents ouverts</h3>
          <p>{normalizeNumber(kpis.open_incidents)}</p>
        </div>
        <div className="card">
          <h3>SLA en retard</h3>
          <p>{normalizeNumber(kpis.sla_late_rate).toFixed(1)}%</p>
        </div>
        <div className="card">
          <h3>Backlog maintenance</h3>
          <p>{normalizeNumber(kpis.active_maintenance_backlog)}</p>
        </div>
        <div className="card">
          <h3>Maintenances en retard</h3>
          <p>{normalizeNumber(kpis.overdue_maintenance)}</p>
        </div>
        <div className="card">
          <h3>Score moyen</h3>
          <p>{normalizeNumber(kpis.average_score).toFixed(1)}/100</p>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Comparatif sociétés (coût, incidents, score)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={companyComparison}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "maintenance_cost") return formatMGA(value);
                  return value;
                }}
              />
              <Legend />
              <Bar dataKey="maintenance_cost" fill="#0b3d91" name="Coût maintenance" />
              <Bar dataKey="open_incidents" fill="#dc2626" name="Incidents ouverts" />
              <Bar dataKey="average_score" fill="#0a8f87" name="Score moyen" />
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
          <h3>Tendance maintenance</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={maintenanceMonthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => formatMGA(value)} />
              <Legend />
              <Line type="monotone" dataKey="value" stroke="#0b3d91" name="Coût maintenance" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Top 10 actifs les plus risqués</h3>
          {topRisksChartData.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={topRisksChartData}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="label" type="category" width={180} />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "Risque 30j") return [value, name];
                    if (name === "Incidents 30j") return [value, name];
                    if (name === "Maintenances en retard") return [value, name];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload;
                    if (!row) return "";
                    return `${row.full_name} (${row.company_name})`;
                  }}
                />
                <Legend />
                <Bar dataKey="risk_score_30d" fill="#dc2626" name="Risque 30j" />
                <Bar dataKey="incident_count_30d" fill="#f59e0b" name="Incidents 30j" />
                <Bar
                  dataKey="overdue_maintenance_count"
                  fill="#0b3d91"
                  name="Maintenances en retard"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p>Aucun actif à risque pour ces filtres.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Amortissement annuel</h3>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <p>
            <strong>Amorti YTD:</strong> {formatMGA(amortizedYtd)}
          </p>
          <p>
            <strong>Cible annuelle:</strong> {formatMGA(amortizationAnnualTarget)}
          </p>
          <p>
            <strong>Reste à amortir:</strong> {formatMGA(amortizationRemaining)}
          </p>
          <p>
            <strong>Couverture:</strong> {amortizationCoverageRate.toFixed(1)}%
          </p>
        </div>
        {amortizationChartData.length ? (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={amortizationChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month_label" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip formatter={(value) => formatMGA(value)} />
              <Legend />
              <Bar yAxisId="left" dataKey="amortized" fill="#0b3d91" name="Amorti mensuel" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke="#0a8f87"
                strokeWidth={3}
                name="Cumul amorti"
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="target_cumulative"
                stroke="#f59e0b"
                strokeWidth={2}
                name="Cumul cible"
                dot={false}
                strokeDasharray="4 4"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p>Aucune donnée d'amortissement disponible (vérifie la migration SQL dashboard).</p>
        )}
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
              <th>Maintenances retard</th>
              <th>Ratio maintenance</th>
              <th>Décision</th>
            </tr>
          </thead>
          <tbody>
            {topRisks.map((item) => (
              <tr key={item.id}>
                <td>{item.name || "-"}</td>
                <td>{item.company_name || "-"}</td>
                <td>{normalizeNumber(item.score).toFixed(1)}</td>
                <td>{normalizeNumber(item.risk_score_30d)}</td>
                <td>{normalizeNumber(item.incident_count_30d)}</td>
                <td>{normalizeNumber(item.overdue_maintenance_count)}</td>
                <td>{normalizeNumber(item.maintenance_ratio).toFixed(2)}%</td>
                <td>{item.recommendation || "-"}</td>
              </tr>
            ))}
            {topRisks.length === 0 && (
              <tr>
                <td colSpan={8}>Aucun actif trouvé pour ces filtres.</td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
          <span>
            Page {riskPage} / {topRiskTotalPages} - {topRisksTotal} actifs
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-secondary"
              disabled={riskPage <= 1 || summaryLoading}
              onClick={() => setRiskPage((p) => Math.max(1, p - 1))}
            >
              Précédent
            </button>
            <button
              className="btn-secondary"
              disabled={riskPage >= topRiskTotalPages || summaryLoading}
              onClick={() => setRiskPage((p) => Math.min(topRiskTotalPages, p + 1))}
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Santé des données</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Contrôle</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Actifs sans valeur</td>
              <td>{normalizeNumber(quality.missing_value)}</td>
            </tr>
            <tr>
              <td>Actifs sans société</td>
              <td>{normalizeNumber(quality.missing_company)}</td>
            </tr>
            <tr>
              <td>Amortissement incomplet</td>
              <td>{normalizeNumber(quality.missing_amortization)}</td>
            </tr>
            <tr>
              <td>Maintenance sans deadline</td>
              <td>{normalizeNumber(quality.maintenance_missing_deadline)}</td>
            </tr>
            <tr>
              <td>Incidents sans titre</td>
              <td>{normalizeNumber(quality.incidents_missing_title)}</td>
            </tr>
          </tbody>
        </table>
      </div>

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
                          {item.asset_name || "-"}
                        </Link>
                      ) : (
                        item.asset_name || "-"
                      )}
                    </td>
                    <td>{item.title || "-"}</td>
                    <td>{formatDate(item.created_at)}</td>
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
                          {item.asset_name || "-"}
                        </Link>
                      ) : (
                        item.asset_name || "-"
                      )}
                    </td>
                    <td>{item.title || "-"}</td>
                    <td>{formatDate(item.due_date)}</td>
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

          <div style={{ gridColumn: "1 / -1" }}>
            <h4 style={{ marginBottom: 8 }}>Assurances à renouveler (14 jours)</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>Actif</th>
                  <th>Société</th>
                  <th>Expire le</th>
                  <th>Jours restants</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {actionsInsuranceExpiring.map((item) => (
                  <tr key={`insurance-action-${item.asset_id}-${item.insurance_end_date}`}>
                    <td>
                      {item.asset_id ? (
                        <Link className="dashboard-link" href={`/assets/${item.asset_id}`}>
                          {item.asset_name || "-"}
                        </Link>
                      ) : (
                        item.asset_name || "-"
                      )}
                    </td>
                    <td>{item.company_name || "-"}</td>
                    <td>{formatDate(item.insurance_end_date)}</td>
                    <td>{normalizeNumber(item.days_remaining)} j</td>
                    <td>
                      <button
                        className="btn-secondary"
                        onClick={() => router.push(`/assets/${item.asset_id}`)}
                      >
                        Voir actif
                      </button>
                    </td>
                  </tr>
                ))}
                {actionsInsuranceExpiring.length === 0 && !insuranceActionsError && (
                  <tr>
                    <td colSpan={5}>Aucune assurance à renouveler dans les 14 jours.</td>
                  </tr>
                )}
                {insuranceActionsError && (
                  <tr>
                    <td colSpan={5}>Alerte assurance indisponible: {insuranceActionsError}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
