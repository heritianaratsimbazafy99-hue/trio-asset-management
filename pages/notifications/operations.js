import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import {
  getEmailQueueStatusClassName,
  getEmailQueueStatusLabel,
  getNotificationTypeLabel,
} from "../../lib/notifications";

const STATUS_FILTERS = ["ALL", "FAILED", "PENDING", "PROCESSING", "SENT", "CANCELED"];
const TYPE_FILTERS = ["ALL", "WORKFLOW_PENDING", "WORKFLOW_APPROVED", "WORKFLOW_REJECTED", "WORKFLOW_FAILED", "INCIDENT_ALERT"];

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function emitSidebarRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("trio-sidebar-refresh"));
}

export default function NotificationOperationsPage() {
  const [userRole, setUserRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState("FAILED");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchData();
  }, [statusFilter, typeFilter]);

  async function fetchData() {
    setLoading(true);
    setError("");

    const { profile } = await getCurrentUserProfile();
    setUserRole(profile?.role || "");

    const canAccess = hasOneRole(profile?.role, [APP_ROLES.CEO, APP_ROLES.DAF]);
    if (!canAccess) {
      setRows([]);
      setMetrics(null);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const [metricsResponse, listResponse] = await Promise.all([
      supabase.rpc("get_email_notification_metrics_secure"),
      supabase.rpc("list_email_notification_queue_secure", {
        p_status: statusFilter,
        p_notification_type: typeFilter,
        p_search: search.trim() || null,
        p_limit: 100,
        p_offset: 0,
      }),
    ]);

    if (metricsResponse.error || listResponse.error) {
      setError(metricsResponse.error?.message || listResponse.error?.message || "Erreur chargement");
      setRows([]);
      setMetrics(null);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const metricsRow = Array.isArray(metricsResponse.data) ? metricsResponse.data[0] : metricsResponse.data;
    const listRows = listResponse.data || [];
    setMetrics(metricsRow || null);
    setRows(listRows);
    setTotalCount(listRows.length ? Number(listRows[0].total_count || 0) : 0);
    setLoading(false);
  }

  async function handleRetry(queueId) {
    setActionLoading(true);
    setError("");
    setMessage("");
    const { error: rpcError } = await supabase.rpc("requeue_email_notification", {
      p_queue_id: queueId,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage("Email replanifié.");
      await fetchData();
      emitSidebarRefresh();
    }
    setActionLoading(false);
  }

  async function handleCancel(queueId) {
    setActionLoading(true);
    setError("");
    setMessage("");
    const { error: rpcError } = await supabase.rpc("cancel_email_notification", {
      p_queue_id: queueId,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage("Email annulé.");
      await fetchData();
    }
    setActionLoading(false);
  }

  async function handleRetryBatch() {
    setActionLoading(true);
    setError("");
    setMessage("");
    const { data, error: rpcError } = await supabase.rpc("requeue_failed_email_notifications", {
      p_limit: 50,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage(`${Number(data || 0)} email(s) en échec replanifié(s).`);
      await fetchData();
      emitSidebarRefresh();
    }
    setActionLoading(false);
  }

  const canAccess = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);

  if (!loading && !canAccess) {
    return (
      <Layout>
        <h1>Supervision email</h1>
        <div className="alert-error">Accès réservé au CEO et DAF.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>Supervision email</h1>
      <p style={{ marginBottom: 12 }}>
        Rôle connecté: {userRole || "-"} | Les tickets maintenance en attente restent validés par
        CEO, DAF ou Resp. maintenance selon le routage actif.
      </p>

      <div className="dashboard-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-solid">
          <h3>En attente</h3>
          <p>{Number(metrics?.pending_count || 0)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>En échec</h3>
          <p>{Number(metrics?.failed_count || 0)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Envoyés 24h</h3>
          <p>{Number(metrics?.sent_last_24h || 0)}</p>
        </div>
        <div className="card kpi-solid">
          <h3>Retry possible</h3>
          <p>{Number(metrics?.retryable_failed_count || 0)}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr auto auto", gap: 12 }}>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_FILTERS.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "Tous les statuts" : getEmailQueueStatusLabel(item)}
              </option>
            ))}
          </select>

          <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPE_FILTERS.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "Tous les types" : getNotificationTypeLabel(item)}
              </option>
            ))}
          </select>

          <input
            className="input"
            placeholder="Rechercher email, destinataire, sujet, erreur..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button className="btn-secondary" onClick={() => fetchData()}>
            Actualiser
          </button>

          <button className="btn-warning" disabled={actionLoading} onClick={handleRetryBatch}>
            Relancer les échecs
          </button>
        </div>

        <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>
          Queue 7 jours: {Number(metrics?.queue_last_7d || 0)} | Plus ancien pending:{" "}
          {formatDate(metrics?.oldest_pending_at)}
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      <div className="card">
        {loading ? (
          <p>Chargement de la supervision email...</p>
        ) : (
          <>
            <p style={{ marginBottom: 12, color: "var(--muted)" }}>
              {totalCount} ligne(s) dans la vue courante.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Destinataire</th>
                    <th>Type</th>
                    <th>Sujet</th>
                    <th>Statut</th>
                    <th>Tentatives</th>
                    <th>Dernière erreur</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const canRetry = ["FAILED", "CANCELED"].includes(String(row.status || "").toUpperCase());
                    const canCancel = ["FAILED", "PENDING"].includes(String(row.status || "").toUpperCase());
                    return (
                      <tr key={row.id}>
                        <td>{formatDate(row.created_at)}</td>
                        <td>
                          <div>{row.recipient_label || "-"}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{row.recipient_email || "-"}</div>
                        </td>
                        <td>{getNotificationTypeLabel(row.notification_type)}</td>
                        <td>
                          <div>{row.subject || "-"}</div>
                          {row.link_path && (
                            <Link className="dashboard-link" href={row.link_path}>
                              Ouvrir la cible
                            </Link>
                          )}
                        </td>
                        <td>
                          <span className={getEmailQueueStatusClassName(row.status)}>
                            {getEmailQueueStatusLabel(row.status)}
                          </span>
                        </td>
                        <td>
                          <div>{Number(row.attempt_count || 0)}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            {formatDate(row.last_attempt_at)}
                          </div>
                        </td>
                        <td style={{ maxWidth: 280 }}>
                          <div>{row.last_error || "-"}</div>
                          {row.sent_at && (
                            <div style={{ color: "var(--muted)", fontSize: 12 }}>
                              Envoyé: {formatDate(row.sent_at)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {canRetry && (
                              <button className="btn-secondary" disabled={actionLoading} onClick={() => handleRetry(row.id)}>
                                Relancer
                              </button>
                            )}
                            {canCancel && (
                              <button className="btn-danger" disabled={actionLoading} onClick={() => handleCancel(row.id)}>
                                Annuler
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8}>Aucune ligne pour ce filtre.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
