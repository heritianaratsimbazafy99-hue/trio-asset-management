import { useEffect, useMemo, useState } from "react";
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
];

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function getAssetIdFromLog(log) {
  if (!log) return null;
  if (log.entity_type === "assets") return log.entity_id;
  if (log.payload?.asset_id) return log.payload.asset_id;
  return null;
}

function stringifyPayload(payload) {
  if (!payload || typeof payload !== "object") return "-";
  const keys = Object.keys(payload);
  if (!keys.length) return "-";
  return keys
    .slice(0, 5)
    .map((key) => `${key}: ${String(payload[key] ?? "-")}`)
    .join(" | ");
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
  }, [actionFilter, page, pageSize]);

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

    let query = supabase
      .from("audit_logs")
      .select("id, actor_user_id, action, entity_type, entity_id, payload, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false });

    if (actionFilter !== "ALL") {
      query = query.eq("action", actionFilter);
    }

    const term = search.trim();
    if (term) {
      query = query.or(
        `action.ilike.%${term}%,entity_type.ilike.%${term}%,entity_id.ilike.%${term}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: logsData, error: logsError, count } = await query;
    if (logsError) {
      setError(logsError.message);
      setLogs([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const rows = logsData || [];
    setLogs(rows);
    setTotalCount(count || 0);

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

  const filteredLogs = useMemo(() => {
    return logs.filter((row) => {
      const actionMatch = actionFilter === "ALL" || row.action === actionFilter;
      if (!actionMatch) return false;

      const term = search.trim().toLowerCase();
      if (!term) return true;

      const actor = getUserLabelById(actorsMap, row.actor_user_id).toLowerCase();
      const payload = stringifyPayload(row.payload).toLowerCase();
      const entity = `${row.entity_type} ${row.entity_id}`.toLowerCase();
      const action = String(row.action || "").toLowerCase();

      return (
        actor.includes(term) ||
        payload.includes(term) ||
        entity.includes(term) ||
        action.includes(term)
      );
    });
  }, [logs, search, actorsMap]);

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
            placeholder="Rechercher (utilisateur, entité, payload, action)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>Entité</th>
                <th>Actif</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((row) => {
                const assetId = getAssetIdFromLog(row);
                const assetName = assetId ? assetsMap[assetId] || assetId : "-";
                return (
                  <tr key={row.id}>
                    <td>{formatDate(row.created_at)}</td>
                    <td>{getUserLabelById(actorsMap, row.actor_user_id)}</td>
                    <td>{row.action}</td>
                    <td>{row.entity_type}:{row.entity_id}</td>
                    <td>
                      {assetId ? (
                        <Link className="dashboard-link" href={`/assets/${assetId}`}>
                          {assetName}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{stringifyPayload(row.payload)}</td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={6}>Aucun log trouvé.</td>
                </tr>
              )}
            </tbody>
          </table>
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
