import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import StatusBadge from "../../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import {
  getCurrentUserProfile,
  OPERATIONAL_LEADERSHIP_ROLES,
  hasOneRole,
} from "../../lib/accessControl";
import {
  fetchUserDirectoryMapByIds,
  getUserLabelById,
} from "../../lib/userDirectory";
import { emitNotificationRefresh } from "../../lib/notificationRefresh";
import {
  getIncidentStatusLabel,
  isIncidentOpen,
  normalizeOperationStatus,
} from "../../lib/operationStatus";

const INCIDENT_FILTERS = [
  { value: "ALL", label: "Tous" },
  { value: "OPEN", label: "Ouverts" },
  { value: "RESOLU", label: "Résolus" },
];

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [usersMap, setUsersMap] = useState({});
  const [statusFilter, setStatusFilter] = useState("OPEN");

  const canCloseIncident = hasOneRole(userRole, OPERATIONAL_LEADERSHIP_ROLES);
  const openIncidents = useMemo(() => incidents.filter(isIncidentOpen), [incidents]);
  const resolvedIncidents = useMemo(
    () => incidents.filter((item) => normalizeOperationStatus(item.status) === "RESOLU"),
    [incidents]
  );
  const displayedIncidents = useMemo(() => {
    if (statusFilter === "OPEN") return openIncidents;
    if (statusFilter === "RESOLU") return resolvedIncidents;
    return incidents;
  }, [incidents, openIncidents, resolvedIncidents, statusFilter]);

  async function fetchIncidents() {
    const [{ data }, { profile }] = await Promise.all([
      supabase
        .from("incidents")
        .select("*, assets(name,status)")
        .order("created_at", { ascending: false }),
      getCurrentUserProfile(),
    ]);

    if (data) {
      setIncidents(data);
      const ids = data.flatMap((item) => [item.reported_by, item.resolved_by]).filter(Boolean);
      const map = await fetchUserDirectoryMapByIds(ids);
      setUsersMap(map);
    }
    setUserRole(profile?.role || "");
  }

  useEffect(() => {
    fetchIncidents();
  }, []);

  async function closeIncident(id) {
    if (!canCloseIncident) {
      setError("Seuls le CEO, le DAF et les responsables maintenance peuvent cloturer un incident.");
      return;
    }

    const confirmed = window.confirm(
      "Clôturer cet incident ? Le statut de l'actif sera recalculé par Supabase selon les incidents et maintenances encore ouverts."
    );
    if (!confirmed) return;

    setLoading(true);
    setError("");
    setMessage("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: updateError } = await supabase
      .from("incidents")
      .update({
        status: "RESOLU",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id || null,
      })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("Incident clôturé. Le statut actif sera EN_SERVICE seulement s'il ne reste aucun blocage.");
      emitNotificationRefresh("incident-closed");
    }

    await fetchIncidents();
    setLoading(false);
  }

  return (
    <Layout>
      <h1>Incidents</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>
      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      <div className="card">
        <div className="operations-overview-grid">
          <div className="operations-overview-item">
            <span>Incidents ouverts</span>
            <strong>{openIncidents.length}</strong>
            <small>Maintiennent l'actif en maintenance.</small>
          </div>
          <div className="operations-overview-item">
            <span>Incidents résolus</span>
            <strong>{resolvedIncidents.length}</strong>
            <small>Ne libèrent l'actif que sans maintenance bloquante.</small>
          </div>
          <div className="operations-overview-item">
            <span>Droit de clôture</span>
            <strong>{canCloseIncident ? "Oui" : "Non"}</strong>
            <small>CEO, DAF, Responsable maintenance.</small>
          </div>
          <div className="operations-overview-item">
            <span>Vue courante</span>
            <strong>{displayedIncidents.length}</strong>
            <small>Résultat après filtre.</small>
          </div>
        </div>

        <div className="operation-filter-row">
          {INCIDENT_FILTERS.map((filter) => (
            <button
              key={filter.value}
              className={statusFilter === filter.value ? "btn-primary" : "btn-secondary"}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
          <button className="btn-secondary" type="button" onClick={fetchIncidents}>
            Actualiser
          </button>
        </div>
      </div>

      <div className="card">
        <div className="operation-table-wrap">
          <table className="table operation-table">
            <thead>
              <tr>
                <th>Actif</th>
                <th>Titre</th>
                <th>Statut</th>
                <th>Signalé le</th>
                <th>Signalé par</th>
                <th>Clôturé par</th>
                <th>Date clôture</th>
                <th>Impact workflow</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayedIncidents.map((incident) => (
                <tr key={incident.id}>
                  <td>
                    {incident.asset_id ? (
                      <Link className="dashboard-link" href={`/assets/${incident.asset_id}`}>
                        {incident.assets?.name || "-"}
                      </Link>
                    ) : (
                      incident.assets?.name || "-"
                    )}
                  </td>
                  <td>{incident.title}</td>

                  <td>
                    <StatusBadge status={incident.status} />
                    <div style={{ color: "#5f6f83", fontSize: 13, marginTop: 4 }}>
                      {getIncidentStatusLabel(incident.status)}
                    </div>
                  </td>

                  <td>
                    {new Date(incident.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td>{getUserLabelById(usersMap, incident.reported_by)}</td>
                  <td>{getUserLabelById(usersMap, incident.resolved_by)}</td>
                  <td>
                    {incident.resolved_at
                      ? new Date(incident.resolved_at).toLocaleDateString("fr-FR")
                      : "-"}
                  </td>
                  <td>
                    <div className="operation-impact">
                      <strong>
                        {isIncidentOpen(incident)
                          ? "Bloque le retour en service"
                          : "Incident résolu"}
                      </strong>
                      <small>
                        Statut actif actuel: {incident.assets?.status || "-"}
                      </small>
                    </div>
                  </td>

                  <td>
                    <div className="operations-action-row">
                      {incident.asset_id && (
                        <Link className="btn-secondary" href={`/assets/${incident.asset_id}`}>
                          Voir actif
                        </Link>
                      )}
                      {isIncidentOpen(incident) && canCloseIncident && (
                        <button
                          className="btn-success"
                          type="button"
                          disabled={loading}
                          onClick={() => closeIncident(incident.id)}
                        >
                          Clôturer
                        </button>
                      )}
                      {isIncidentOpen(incident) && !canCloseIncident && <span>-</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {displayedIncidents.length === 0 && (
                <tr>
                  <td colSpan={9}>Aucun incident pour ce filtre.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
