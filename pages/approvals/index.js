import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { getCurrentUserProfile } from "../../lib/accessControl";
import { fetchUserDirectoryMapByIds, getUserLabelById } from "../../lib/userDirectory";
import { formatMGA } from "../../lib/currency";
import {
  getWorkflowPayloadSummary,
  getWorkflowRequestTypeLabel,
  getWorkflowStatusClassName,
  getWorkflowStatusLabel,
} from "../../lib/workflowRequests";

const STATUS_FILTERS = ["PENDING", "APPROVED", "REJECTED", "FAILED", "ALL"];

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function formatRequestFieldValue(key, value) {
  if (value === null || value === undefined || value === "") return "-";

  if (
    [
      "cost",
      "old_purchase_value",
      "new_purchase_value",
      "old_value",
      "new_value",
      "old_effective_purchase_value",
      "new_effective_purchase_value",
    ].includes(key)
  ) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? formatMGA(numeric) : String(value);
  }

  if (key === "due_date") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("fr-FR");
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function buildRequestDetailEntries(request) {
  const payload =
    request?.payload && typeof request.payload === "object" ? request.payload : {};
  const requestType = String(request?.request_type || "").toUpperCase();
  const entries = [];
  const consumedKeys = new Set();

  function pushEntry(label, key, value) {
    consumedKeys.add(key);
    if (value === null || value === undefined || value === "") return;
    entries.push({
      key,
      label,
      value: formatRequestFieldValue(key, value),
    });
  }

  if (requestType === "MAINTENANCE_START") {
    pushEntry("Ticket maintenance", "maintenance_id", payload.maintenance_id);
    pushEntry("Titre", "title", payload.title || request.title);
    pushEntry("Description", "description", payload.description);
    pushEntry("Coût", "cost", payload.cost);
    pushEntry("Priorité", "priority", payload.priority);
    pushEntry("Deadline", "due_date", payload.due_date);
    pushEntry("Statut demandé", "requested_status", payload.requested_status);
  } else if (requestType === "ASSET_PURCHASE_VALUE_CHANGE") {
    pushEntry(
      "Ancienne valeur d'achat",
      "old_effective_purchase_value",
      payload.old_effective_purchase_value
    );
    pushEntry(
      "Nouvelle valeur d'achat",
      "new_effective_purchase_value",
      payload.new_effective_purchase_value
    );
  } else if (requestType === "ASSET_DELETE") {
    pushEntry("Statut actuel", "current_status", payload.current_status);
  } else if (requestType === "ASSET_REBUS") {
    pushEntry("Statut actuel", "current_status", payload.current_status);
    pushEntry("Statut cible", "target_status", payload.target_status);
  }

  Object.entries(payload)
    .filter(([key]) => {
      return (
        !consumedKeys.has(key) &&
        ![
          "asset_id",
          "asset_name",
          "asset_code",
          "company_id",
          "company_name",
        ].includes(key)
      );
    })
    .forEach(([key, value]) => {
      entries.push({
        key,
        label: key.replaceAll("_", " "),
        value: formatRequestFieldValue(key, value),
      });
    });

  return entries;
}

export default function ApprovalsPage() {
  const [requests, setRequests] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [userRole, setUserRole] = useState("");
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selectedRequestId, setSelectedRequestId] = useState("");

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedRequestId) return;
    if (!requests.some((item) => item.id === selectedRequestId)) {
      setSelectedRequestId("");
    }
  }, [requests, selectedRequestId]);

  async function fetchRequests() {
    setLoading(true);
    setError("");

    const { profile } = await getCurrentUserProfile();
    setUserRole(profile?.role || "");

    const { data, error: rpcError } = await supabase.rpc(
      "list_workflow_requests_secure",
      {
        p_status: statusFilter,
        p_limit: 100,
        p_offset: 0,
      }
    );

    if (rpcError) {
      setError(rpcError.message);
      setRequests([]);
      setUsersMap({});
      setLoading(false);
      return;
    }

    const rows = data || [];
    setRequests(rows);

    const userIds = rows.map((item) => item.requested_by).filter(Boolean);
    const map = await fetchUserDirectoryMapByIds(userIds);
    setUsersMap(map);
    setLoading(false);
  }

  async function approveRequest(request) {
    const note = window.prompt("Commentaire d'approbation (optionnel)", "");
    if (note === null) return;

    setActionLoading(true);
    setError("");
    setMessage("");

    const { error: rpcError } = await supabase.rpc("approve_workflow_request", {
      p_request_id: request.id,
      p_note: note.trim() || null,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage("Validation enregistrée.");
      await fetchRequests();
    }

    setActionLoading(false);
  }

  async function rejectRequest(request) {
    const note = window.prompt("Motif de rejet (obligatoire)", "");
    if (note === null) return;

    if (!note.trim()) {
      setError("Le motif de rejet est obligatoire.");
      return;
    }

    setActionLoading(true);
    setError("");
    setMessage("");

    const { error: rpcError } = await supabase.rpc("reject_workflow_request", {
      p_request_id: request.id,
      p_note: note.trim(),
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage("Demande rejetée.");
      await fetchRequests();
    }

    setActionLoading(false);
  }

  const selectedRequest =
    requests.find((item) => item.id === selectedRequestId) || null;
  const selectedRequestDetails = selectedRequest
    ? buildRequestDetailEntries(selectedRequest)
    : [];

  return (
    <Layout>
      <h1>Validations</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>
      <div className="alert-warning" style={{ marginBottom: 12 }}>
        Cette page affiche vos demandes et, selon votre rôle, les validations que vous pouvez traiter.
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_FILTERS.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "Tous les statuts" : getWorkflowStatusLabel(item)}
              </option>
            ))}
          </select>

          <button className="btn-secondary" onClick={() => fetchRequests()}>
            Actualiser
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      {selectedRequest && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            className="dashboard-header-row"
            style={{ gap: 16, alignItems: "flex-start", marginBottom: 12 }}
          >
            <div>
              <h3 style={{ marginBottom: 6 }}>
                {selectedRequest.title || getWorkflowRequestTypeLabel(selectedRequest.request_type)}
              </h3>
              <p style={{ color: "var(--muted)", margin: 0 }}>
                {getWorkflowRequestTypeLabel(selectedRequest.request_type)} | Créée le{" "}
                {formatDate(selectedRequest.created_at)}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selectedRequest.can_approve && (
                <>
                  <button
                    className="btn-success"
                    disabled={actionLoading}
                    onClick={() => approveRequest(selectedRequest)}
                  >
                    Valider
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={actionLoading}
                    onClick={() => rejectRequest(selectedRequest)}
                  >
                    Rejeter
                  </button>
                </>
              )}
              <button
                className="btn-secondary"
                onClick={() => setSelectedRequestId("")}
                disabled={actionLoading}
              >
                Fermer
              </button>
            </div>
          </div>

          <div className="dashboard-grid" style={{ marginBottom: 12 }}>
            <div className="card" style={{ margin: 0 }}>
              <strong>Statut</strong>
              <div style={{ marginTop: 8 }}>
                <span className={getWorkflowStatusClassName(selectedRequest.status)}>
                  {getWorkflowStatusLabel(selectedRequest.status)}
                </span>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <strong>Demandeur</strong>
              <div style={{ marginTop: 8 }}>
                {getUserLabelById(usersMap, selectedRequest.requested_by)}
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <strong>Actif</strong>
              <div style={{ marginTop: 8 }}>
                {selectedRequest.asset_id ? (
                  <Link className="dashboard-link" href={`/assets/${selectedRequest.asset_id}`}>
                    {selectedRequest.asset_name || selectedRequest.asset_code || selectedRequest.asset_id}
                  </Link>
                ) : (
                  selectedRequest.asset_name || selectedRequest.asset_code || "-"
                )}
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <strong>Société</strong>
              <div style={{ marginTop: 8 }}>{selectedRequest.company_name || "-"}</div>
            </div>
          </div>

          {selectedRequest.reason && (
            <div className="alert-warning" style={{ marginBottom: 12 }}>
              <strong>Motif:</strong> {selectedRequest.reason}
            </div>
          )}

          <div className="card" style={{ margin: 0 }}>
            <h4 style={{ marginBottom: 12 }}>Détail de la demande</h4>
            {selectedRequestDetails.length ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {selectedRequestDetails.map((entry) => (
                  <div key={`${selectedRequest.id}-${entry.key}`} className="card" style={{ margin: 0 }}>
                    <strong style={{ textTransform: "capitalize" }}>{entry.label}</strong>
                    <div style={{ marginTop: 8, color: "var(--text)" }}>{entry.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p>Aucun détail complémentaire disponible pour cette demande.</p>
            )}
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p>Chargement des demandes...</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Actif</th>
                  <th>Société</th>
                  <th>Demandeur</th>
                  <th>Progression</th>
                  <th>Détails</th>
                  <th>Statut</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const assetLabel = request.asset_name || request.asset_code || "-";
                  const assetCodeSuffix = request.asset_code ? ` (${request.asset_code})` : "";
                  const canOpenAsset = Boolean(request.asset_id);
                  const progress = `${request.approval_count || 0} / ${request.required_approvals || 0}`;

                  return (
                    <tr key={request.id}>
                      <td>{formatDate(request.created_at)}</td>
                      <td>{getWorkflowRequestTypeLabel(request.request_type)}</td>
                      <td>
                        {canOpenAsset ? (
                          <Link className="dashboard-link" href={`/assets/${request.asset_id}`}>
                            {assetLabel}
                            {assetCodeSuffix}
                          </Link>
                        ) : (
                          `${assetLabel}${assetCodeSuffix}`
                        )}
                      </td>
                      <td>{request.company_name || "-"}</td>
                      <td>{getUserLabelById(usersMap, request.requested_by)}</td>
                      <td>{progress}</td>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedRequestId(request.id)}
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              textAlign: "left",
                              color: "#1d4ed8",
                              cursor: "pointer",
                              font: "inherit",
                            }}
                          >
                            {request.title || getWorkflowPayloadSummary(request)}
                          </button>
                          <small style={{ color: "#5f6f83" }}>
                            {getWorkflowPayloadSummary(request)}
                          </small>
                          {request.reason && (
                            <small style={{ color: "#5f6f83" }}>
                              Motif: {request.reason}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={getWorkflowStatusClassName(request.status)}>
                          {getWorkflowStatusLabel(request.status)}
                        </span>
                      </td>
                      <td>
                        {request.can_approve ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="btn-secondary"
                              disabled={actionLoading}
                              onClick={() => setSelectedRequestId(request.id)}
                            >
                              Voir détail
                            </button>
                            <button
                              className="btn-success"
                              disabled={actionLoading}
                              onClick={() => approveRequest(request)}
                            >
                              Valider
                            </button>
                            <button
                              className="btn-secondary"
                              disabled={actionLoading}
                              onClick={() => rejectRequest(request)}
                            >
                              Rejeter
                            </button>
                          </div>
                        ) : request.already_decided ? (
                          <span>Décision déjà prise</span>
                        ) : (
                          <button
                            className="btn-secondary"
                            disabled={actionLoading}
                            onClick={() => setSelectedRequestId(request.id)}
                          >
                            Voir détail
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {requests.length === 0 && (
                  <tr>
                    <td colSpan={9}>Aucune demande pour ce filtre.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
