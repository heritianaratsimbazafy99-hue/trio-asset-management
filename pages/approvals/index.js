import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { getCurrentUserProfile } from "../../lib/accessControl";
import { fetchUserDirectoryMapByIds, getUserLabelById } from "../../lib/userDirectory";
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

export default function ApprovalsPage() {
  const [requests, setRequests] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [userRole, setUserRole] = useState("");
  const [statusFilter, setStatusFilter] = useState("PENDING");

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

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
                          <span>{getWorkflowPayloadSummary(request)}</span>
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
                          <span>-</span>
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
