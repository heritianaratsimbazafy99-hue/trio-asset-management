import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import {
  DEFAULT_RULE_TEMPLATES,
  RULE_COMPARATOR_OPTIONS,
  RULE_SEVERITY_OPTIONS,
  evaluateAssetRules,
  evaluateDataRules,
  normalizeRuleRows,
} from "../../lib/ruleEngine";

function getSeverityBadgeClass(severity) {
  const normalized = String(severity || "").toUpperCase();
  if (normalized === "CRITICAL") return "badge-danger";
  if (normalized === "WARNING") return "badge-warning";
  return "badge-success";
}

export default function RulesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isCEO, setIsCEO] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [rules, setRules] = useState([]);
  const [assets, setAssets] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [scoringConfigs, setScoringConfigs] = useState([]);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!loading) {
      fetchRulePreview();
    }
  }, [selectedCompanyId]);

  async function bootstrap() {
    setLoading(true);
    setError("");

    const [{ profile }, { data: orgs }, { data: rulesData, error: rulesError }, { data: scoringData }] =
      await Promise.all([
        getCurrentUserProfile(),
        supabase.from("organisations").select("id, name").order("name", { ascending: true }),
        supabase.from("company_rule_configs").select("*").order("company_id", { ascending: true }),
        supabase.from("company_scoring_config").select("*"),
      ]);

    if (rulesError) {
      setError(rulesError.message);
    }

    const companyList = orgs || [];
    const defaultCompanyId = profile?.company_id || companyList[0]?.id || "";

    setIsCEO(hasOneRole(profile?.role, [APP_ROLES.CEO]));
    setCompanies(companyList);
    setSelectedCompanyId(defaultCompanyId);
    setRules(normalizeRuleRows(rulesData || []));
    setScoringConfigs(scoringData || []);
    setLoading(false);
  }

  async function fetchRulePreview() {
    setError("");

    let assetsQuery = supabase
      .from("assets")
      .select("*, organisations(name)")
      .order("updated_at", { ascending: false });

    if (selectedCompanyId) {
      assetsQuery = assetsQuery.eq("company_id", selectedCompanyId);
    }

    const { data: assetsData, error: assetsError } = await assetsQuery;
    if (assetsError) {
      setError(assetsError.message);
      return;
    }

    const assetIds = (assetsData || []).map((item) => item.id).filter(Boolean);

    let incidentsData = [];
    let maintenanceData = [];
    if (assetIds.length) {
      const [incidentsResponse, maintenanceResponse] = await Promise.all([
        supabase.from("incidents").select("*").in("asset_id", assetIds),
        supabase.from("maintenance").select("*").in("asset_id", assetIds),
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
  }

  async function saveRule(rule) {
    if (!isCEO) return;
    setSaving(true);
    setError("");
    setSuccess("");

    const payload = {
      company_id: rule.company_id,
      rule_code: rule.rule_code,
      rule_name: rule.rule_name,
      scope: rule.scope,
      comparator: rule.comparator,
      threshold_value: Number(rule.threshold_value || 0),
      severity: rule.severity,
      is_enabled: Boolean(rule.is_enabled),
      params: rule.params || {},
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("company_rule_configs")
      .upsert([payload], { onConflict: "company_id,rule_code" });

    if (upsertError) {
      setError(upsertError.message);
    } else {
      setSuccess(`Règle ${rule.rule_name} mise à jour.`);
      const { data } = await supabase
        .from("company_rule_configs")
        .select("*")
        .order("company_id", { ascending: true });
      setRules(normalizeRuleRows(data || []));
    }

    setSaving(false);
  }

  const visibleRules = useMemo(() => {
    if (!selectedCompanyId) return [];
    return rules.filter((item) => item.company_id === selectedCompanyId);
  }, [rules, selectedCompanyId]);

  const scoringConfigByCompanyId = useMemo(() => {
    const map = {};
    scoringConfigs.forEach((item) => {
      if (item?.company_id) {
        map[item.company_id] = item;
      }
    });
    return map;
  }, [scoringConfigs]);

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

  const assetRuleHits = useMemo(() => {
    return assets
      .flatMap((asset) => {
        const companyRules = rules.filter(
          (rule) => rule.company_id === asset.company_id && rule.scope === "ASSET"
        );
        const hits = evaluateAssetRules({
          asset,
          incidents: incidentsByAssetId[asset.id] || [],
          maintenance: maintenanceByAssetId[asset.id] || [],
          scoringConfig: scoringConfigByCompanyId[asset.company_id] || null,
          rules: companyRules,
        });

        return hits.map((hit) => ({
          ...hit,
          asset_id: asset.id,
          asset_name: asset.name,
          company_name: asset.organisations?.name || "-",
        }));
      })
      .sort((a, b) => a.asset_name.localeCompare(b.asset_name))
      .slice(0, 30);
  }, [
    assets,
    incidentsByAssetId,
    maintenanceByAssetId,
    rules,
    scoringConfigByCompanyId,
  ]);

  const dataRuleHits = useMemo(() => {
    return evaluateDataRules({
      assets,
      maintenance,
      rules: rules.filter(
        (rule) => rule.company_id === selectedCompanyId && rule.scope === "DATA"
      ),
    });
  }, [assets, maintenance, rules, selectedCompanyId]);

  if (loading) {
    return (
      <Layout>
        <h1>Moteur de règles</h1>
        <p>Chargement des règles...</p>
      </Layout>
    );
  }

  if (!isCEO) {
    return (
      <Layout>
        <h1>Moteur de règles</h1>
        <div className="alert-error">Accès réservé au CEO.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>Moteur de règles</h1>
      <p className="page-subtitle">
        Configuration no-code des seuils métier par société.
      </p>

      {error && <div className="alert-error">{error}</div>}
      {success && <div className="alert-warning">{success}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="dashboard-filter-grid">
          <select
            className="select"
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <button className="btn-secondary" onClick={() => fetchRulePreview()}>
            Actualiser aperçu
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Règles configurables</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Règle</th>
              <th>Scope</th>
              <th>Comparateur</th>
              <th>Seuil</th>
              <th>Sévérité</th>
              <th>Active</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleRules.map((rule) => (
              <tr key={`${rule.company_id}-${rule.rule_code}`}>
                <td>
                  <div>
                    <strong>{rule.rule_name}</strong>
                    <div style={{ color: "#5f6f83", marginTop: 4 }}>
                      {rule.description || DEFAULT_RULE_TEMPLATES.find((item) => item.rule_code === rule.rule_code)?.description || "-"}
                    </div>
                  </div>
                </td>
                <td>{rule.scope}</td>
                <td>
                  <select
                    className="select"
                    value={rule.comparator}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item) =>
                          item.company_id === rule.company_id && item.rule_code === rule.rule_code
                            ? { ...item, comparator: e.target.value }
                            : item
                        )
                      )
                    }
                  >
                    {RULE_COMPARATOR_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={rule.threshold_value}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item) =>
                          item.company_id === rule.company_id && item.rule_code === rule.rule_code
                            ? { ...item, threshold_value: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    className="select"
                    value={rule.severity}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item) =>
                          item.company_id === rule.company_id && item.rule_code === rule.rule_code
                            ? { ...item, severity: e.target.value }
                            : item
                        )
                      )
                    }
                  >
                    {RULE_SEVERITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(rule.is_enabled)}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((item) =>
                          item.company_id === rule.company_id && item.rule_code === rule.rule_code
                            ? { ...item, is_enabled: e.target.checked }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <button className="btn-secondary" disabled={saving} onClick={() => saveRule(rule)}>
                    Sauvegarder
                  </button>
                </td>
              </tr>
            ))}
            {visibleRules.length === 0 && (
              <tr>
                <td colSpan={7}>Aucune règle trouvée pour cette société.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3>Règles déclenchées sur les actifs</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Actif</th>
                <th>Société</th>
                <th>Règle</th>
                <th>Valeur</th>
                <th>Seuil</th>
                <th>Sévérité</th>
              </tr>
            </thead>
            <tbody>
              {assetRuleHits.map((hit) => (
                <tr key={`${hit.asset_id}-${hit.rule_code}`}>
                  <td>
                    <Link className="dashboard-link" href={`/assets/${hit.asset_id}`}>
                      {hit.asset_name}
                    </Link>
                  </td>
                  <td>{hit.company_name}</td>
                  <td>{hit.rule_name}</td>
                  <td>{hit.metricLabel}</td>
                  <td>
                    {hit.comparator} {hit.thresholdLabel}
                  </td>
                  <td>
                    <span className={getSeverityBadgeClass(hit.severity)}>
                      {hit.severity}
                    </span>
                  </td>
                </tr>
              ))}
              {assetRuleHits.length === 0 && (
                <tr>
                  <td colSpan={6}>Aucune règle actif déclenchée.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Règles qualité déclenchées</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Règle</th>
                <th>Valeur</th>
                <th>Seuil</th>
                <th>Sévérité</th>
              </tr>
            </thead>
            <tbody>
              {dataRuleHits.map((hit) => (
                <tr key={hit.rule_code}>
                  <td>{hit.rule_name}</td>
                  <td>{hit.metricLabel}</td>
                  <td>
                    {hit.comparator} {hit.thresholdLabel}
                  </td>
                  <td>
                    <span className={getSeverityBadgeClass(hit.severity)}>
                      {hit.severity}
                    </span>
                  </td>
                </tr>
              ))}
              {dataRuleHits.length === 0 && (
                <tr>
                  <td colSpan={4}>Aucune règle qualité déclenchée.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
