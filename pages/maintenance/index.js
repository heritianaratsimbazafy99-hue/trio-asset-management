import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { computeMaintenanceSlaStatus } from "../../lib/sla";
import {
  getCurrentUserProfile,
  OPERATIONAL_LEADERSHIP_ROLES,
  hasOneRole,
} from "../../lib/accessControl";
import {
  fetchUserDirectoryMapByIds,
  getUserLabelById,
} from "../../lib/userDirectory";
import { formatMGA } from "../../lib/currency";
import {
  getMaintenanceStatusClassName,
  getMaintenanceStatusLabel,
  isIncidentOpen,
  isMaintenanceBlockingAsset,
  normalizeOperationStatus,
} from "../../lib/operationStatus";
import { emitNotificationRefresh } from "../../lib/notificationRefresh";

export default function MaintenancePage() {
  const router = useRouter();
  const [maintenance, setMaintenance] = useState([]);
  const [replacementAssets, setReplacementAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [usersMap, setUsersMap] = useState({});
  const [closeDraft, setCloseDraft] = useState(null);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState([]);

  const canCloseMaintenance = hasOneRole(userRole, OPERATIONAL_LEADERSHIP_ROLES);

  function canMarkMaintenanceCompleted(item) {
    return (
      isMaintenanceBlockingAsset(item) &&
      normalizeOperationStatus(item?.approval_status) !== "EN_ATTENTE_VALIDATION" &&
      normalizeOperationStatus(item?.status) !== "EN_ATTENTE_VALIDATION"
    );
  }

  async function fetchData() {
    const [{ data }, { data: replacementData }, { profile }] = await Promise.all([
      supabase
      .from("maintenance")
      .select("*, assets(name,status)")
      .order("created_at", { ascending: false }),
      supabase
        .from("assets")
        .select("id, name, code, organisations(name)")
        .eq("status", "REBUS")
        .order("created_at", { ascending: false })
        .limit(20),
      getCurrentUserProfile(),
    ]);

    setUserRole(profile?.role || "");
    setMaintenance(data || []);
    setReplacementAssets(replacementData || []);
    const ids = (data || []).flatMap((item) => [item.reported_by, item.completed_by]).filter(Boolean);
    const map = await fetchUserDirectoryMapByIds(ids);
    setUsersMap(map);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function prepareMaintenanceClosure(item) {
    if (!canCloseMaintenance) {
      setError("Seuls le CEO, le DAF et les responsables maintenance peuvent cloturer.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const { data: openIncidents, error: incidentError } = await supabase
      .from("incidents")
      .select("id,title,description,status,created_at")
      .eq("asset_id", item.asset_id)
      .order("created_at", { ascending: false });

    if (incidentError) {
      setError(incidentError.message);
      setLoading(false);
      return;
    }

    const blockingIncidents = (openIncidents || []).filter(isIncidentOpen);
    if (blockingIncidents.length > 0) {
      setCloseDraft({ maintenance: item, incidents: blockingIncidents });
      setSelectedIncidentIds([]);
      setLoading(false);
      return;
    }

    await completeMaintenance(item, []);
  }

  async function completeMaintenance(item, incidentIdsToResolve = []) {
    if (!canCloseMaintenance) {
      setError("Seuls le CEO, le DAF et les responsables maintenance peuvent cloturer.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (incidentIdsToResolve.length > 0) {
      const { error: incidentUpdateError } = await supabase
        .from("incidents")
        .update({
          status: "RESOLU",
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id || null,
        })
        .in("id", incidentIdsToResolve);

      if (incidentUpdateError) {
        setError(incidentUpdateError.message);
        setLoading(false);
        return;
      }
    }

    const { error: updateError } = await supabase
      .from("maintenance")
      .update({
        is_completed: true,
        status: "TERMINEE",
        completed_at: new Date().toISOString(),
        completed_by: user?.id || null,
      })
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      const incidentText = incidentIdsToResolve.length
        ? ` ${incidentIdsToResolve.length} incident(s) lié(s) clôturé(s).`
        : "";
      setMessage(`Maintenance clôturée.${incidentText} Le statut actif sera recalculé automatiquement.`);
      emitNotificationRefresh("maintenance-closed");
      setCloseDraft(null);
      setSelectedIncidentIds([]);
    }

    await fetchData();
    setLoading(false);
  }

  function toggleIncidentSelection(incidentId) {
    setSelectedIncidentIds((current) =>
      current.includes(incidentId)
        ? current.filter((item) => item !== incidentId)
        : [...current, incidentId]
    );
  }

  return (
    <Layout>
      <h1>Maintenance</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>
      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      {closeDraft && (
        <div className="operation-close-panel">
          <h3>Clôture maintenance avec incidents liés</h3>
          <p>
            Des incidents restent ouverts sur cet actif. Sélectionne uniquement ceux qui sont
            réellement résolus par cette maintenance avant de clôturer.
          </p>
          <div className="operation-check-list">
            {closeDraft.incidents.map((incident) => (
              <label className="operation-check-item" key={incident.id}>
                <input
                  type="checkbox"
                  checked={selectedIncidentIds.includes(incident.id)}
                  onChange={() => toggleIncidentSelection(incident.id)}
                />
                <span>
                  <strong>{incident.title || incident.description || "Incident"}</strong>
                  <small style={{ display: "block", color: "#5f6f83", marginTop: 4 }}>
                    Signalé le{" "}
                    {incident.created_at
                      ? new Date(incident.created_at).toLocaleDateString("fr-FR")
                      : "-"}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="operations-action-row">
            <button
              className="btn-success"
              type="button"
              disabled={loading}
              onClick={() => completeMaintenance(closeDraft.maintenance, selectedIncidentIds)}
            >
              Clôturer maintenance
              {selectedIncidentIds.length ? ` + ${selectedIncidentIds.length} incident(s)` : ""}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={loading}
              onClick={() => {
                setCloseDraft(null);
                setSelectedIncidentIds([]);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="maintenance-table-wrap">
          <table className="table maintenance-table">
            <thead>
              <tr>
                <th>Actif</th>
                <th>Titre</th>
                <th>Coût</th>
                <th>Priorité</th>
                <th>Deadline</th>
                <th className="cell-center">SLA</th>
                <th>Signalé par</th>
                <th>Clôturé par</th>
                <th>Date clôture</th>
                <th className="cell-center">Statut</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {maintenance.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.asset_id ? (
                      <Link className="dashboard-link" href={`/assets/${m.asset_id}`}>
                        {m.assets?.name || "-"}
                      </Link>
                    ) : (
                      m.assets?.name || "-"
                    )}
                  </td>
                  <td>{m.title}</td>
                  <td>{formatMGA(m.cost)}</td>
                  <td>{m.priority || "-"}</td>
                  <td>
                    {m.due_date
                      ? new Date(m.due_date).toLocaleDateString("fr-FR")
                      : "-"}
                  </td>
                  <td className="cell-center cell-nowrap">
                    <span className={`sla-badge ${computeMaintenanceSlaStatus(m).toLowerCase()}`}>
                      {computeMaintenanceSlaStatus(m)}
                    </span>
                  </td>
                  <td className="maintenance-cell-user">
                    {getUserLabelById(usersMap, m.reported_by)}
                  </td>
                  <td className="maintenance-cell-user">
                    {getUserLabelById(usersMap, m.completed_by)}
                  </td>
                  <td>
                    {m.completed_at
                      ? new Date(m.completed_at).toLocaleDateString("fr-FR")
                      : "-"}
                  </td>

                  <td className="cell-center cell-nowrap">
                    <span className={getMaintenanceStatusClassName(m)}>
                      {getMaintenanceStatusLabel(m)}
                    </span>
                  </td>

                  <td>
                    {canMarkMaintenanceCompleted(m) && canCloseMaintenance && (
                      <button
                        className="btn-success"
                        disabled={loading}
                        onClick={() => prepareMaintenanceClosure(m)}
                      >
                        Marquer terminée
                      </button>
                    )}
                    {canMarkMaintenanceCompleted(m) && !canCloseMaintenance && <span>-</span>}
                    {!canMarkMaintenanceCompleted(m) && <span>-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3>Actifs à remplacer (rebus)</h3>
          <button className="btn-secondary" onClick={() => router.push("/replacement-plan")}>
            Ouvrir plan de remplacement
          </button>
        </div>
        {replacementAssets.length === 0 ? (
          <p>Aucun actif en rebus.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Actif</th>
                <th>Code</th>
                <th>Société</th>
              </tr>
            </thead>
            <tbody>
              {replacementAssets.map((asset) => (
                <tr key={`replacement-${asset.id}`}>
                  <td>
                    <Link className="dashboard-link" href={`/assets/${asset.id}`}>
                      {asset.name || "-"}
                    </Link>
                  </td>
                  <td>{asset.code || "-"}</td>
                  <td>{asset.organisations?.name || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
