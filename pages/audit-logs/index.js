import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import { fetchUserDirectoryMapByIds, getUserLabelById } from "../../lib/userDirectory";

const ACTION_OPTIONS = [
  "ALL",
  "ASSET_DELETE",
  "INCIDENT_CLOSE",
  "MAINTENANCE_CLOSE",
  "ASSET_ASSIGNMENT_INITIAL",
  "ASSET_ASSIGNMENT_CHANGE",
  "ASSET_PURCHASE_VALUE_UPDATE",
  "WORKFLOW_REQUEST_CREATED",
  "WORKFLOW_REQUEST_APPROVAL_RECORDED",
  "WORKFLOW_REQUEST_APPLIED",
  "WORKFLOW_REQUEST_REJECTED",
  "WORKFLOW_REQUEST_FAILED",
];

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function formatActionLabel(action) {
  if (!action) return "-";
  return String(action).replaceAll("_", " ");
}

function normalizePayloadValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function getPayloadEntries(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload).slice(0, 6).map(([key, value]) => ({
    key,
    value: normalizePayloadValue(value),
  }));
}

function getAssetIdFromLog(log) {
  if (!log) return null;
  if (log.entity_type === "assets") return log.entity_id;
  if (log.payload?.asset_id) return log.payload.asset_id;
  return null;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [actorsMap, setActorsMap] = useState({});
  const [assetsMap, setAssetsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [userRole, setUserRole] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchAuditLogs();
  }, [actionFilter, page, pageSize, search]);

  async function fetchAuditLogs() {
    setLoading(true);
    setError("");

    const { profile } = await getCurrentUserProfile();
    setUserRole(profile?.role || "-");

    const canAccessAudit = hasOneRole(profile?.role, [APP_ROLES.CEO, APP_ROLES.DAF]);
    if (!canAccessAudit) {
      setLogs([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const from = (page - 1) * pageSize;
    const { data: logsData, error: logsError } = await supabase.rpc(
      "search_audit_logs_secure",
      {
        p_action: actionFilter,
        p_search: search.trim() || null,
        p_limit: pageSize,
        p_offset: from,
      }
    );

    if (logsError) {
      setError(logsError.message);
      setLogs([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const rows = logsData || [];
    setLogs(rows);
    setTotalCount(rows.length ? Number(rows[0].total_count || 0) : 0);

    const actorIds = rows.map((row) => row.actor_user_id).filter(Boolean);
    const users = await fetchUserDirectoryMapByIds(actorIds);
    setActorsMap(users);

    const assetIds = Array.from(
      new Set(rows.map((row) => getAssetIdFromLog(row)).filter(Boolean))
    );

    if (assetIds.length) {
      const { data: assetsData } = await supabase
        .from("assets")
        .select("id, name")
        .in("id", assetIds);

      const map = {};
      (assetsData || []).forEach((asset) => {
        map[asset.id] = asset.name || asset.id;
      });
      setAssetsMap(map);
    } else {
      setAssetsMap({});
    }

    setLoading(false);
  }

  const canAccessAudit = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);

  if (!loading && !canAccessAudit) {
    return (
      <Layout>
        <h1>Journal d'audit</h1>
        <div className="alert-error">Accès réservé au CEO et DAF.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>Journal d'audit</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 12 }}>
          <select
            className="select"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
          >
            {ACTION_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "Toutes les actions" : item}
              </option>
            ))}
          </select>

          <input
            className="input"
            placeholder="Rechercher (utilisateur, actif, payload, action)..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />

          <button className="btn-secondary" onClick={() => fetchAuditLogs()}>
            Actualiser
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <p>Chargement des logs...</p>
        ) : (
          <div className="audit-table-wrap">
            <table className="table audit-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Utilisateur</th>
                  <th>Action</th>
                  <th>Actif</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => {
                  const assetId = getAssetIdFromLog(row);
                  const payloadAssetName =
                    typeof row.payload?.name === "string" ? row.payload.name : "";
                  const assetName = assetId
                    ? assetsMap[assetId] || payloadAssetName || assetId
                    : payloadAssetName || "-";
                  const hasLiveAsset = Boolean(assetId && assetsMap[assetId]);
                  const payloadEntries = getPayloadEntries(row.payload);
                  return (
                    <tr key={row.id}>
                      <td className="audit-cell-date">{formatDate(row.created_at)}</td>
                      <td className="audit-cell-user">{getUserLabelById(actorsMap, row.actor_user_id)}</td>
                      <td className="audit-cell-action">
                        <span className="audit-action-pill" title={row.action}>
                          {formatActionLabel(row.action)}
                        </span>
                      </td>
                      <td className="audit-cell-asset">
                        {hasLiveAsset ? (
                          <Link className="dashboard-link" href={`/assets/${assetId}`}>
                            {assetName}
                          </Link>
                        ) : (
                          assetName
                        )}
                      </td>
                      <td className="audit-cell-details">
                        {payloadEntries.length ? (
                          <div className="audit-details-list">
                            {payloadEntries.map((entry) => (
                              <div key={`${row.id}-${entry.key}`} className="audit-detail-item">
                                <span className="audit-detail-key">{entry.key}</span>
                                <span className="audit-detail-value">{entry.value}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5}>Aucun log trouvé.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <span>
              Page {page} - {totalCount} logs
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                className="select"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value="20">20 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
              <button
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Précédent
              </button>
              <button
                className="btn-secondary"
                disabled={page * pageSize >= totalCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
