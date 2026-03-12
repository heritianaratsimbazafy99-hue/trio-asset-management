import { useEffect, useState } from "react";
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

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [error, setError] = useState("");
  const [usersMap, setUsersMap] = useState({});

  const canCloseIncident = hasOneRole(userRole, OPERATIONAL_LEADERSHIP_ROLES);

  async function fetchIncidents() {
    const [{ data }, { profile }] = await Promise.all([
      supabase
        .from("incidents")
        .select("*, assets(name)")
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

    setLoading(true);
    setError("");
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
    }

    await fetchIncidents();
    setLoading(false);
  }

  return (
    <Layout>
      <h1>Incidents</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>
      {error && <div className="alert-error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Actif</th>
              <th>Titre</th>
              <th>Statut</th>
              <th>Signalé le</th>
              <th>Signalé par</th>
              <th>Clôturé par</th>
              <th>Date clôture</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident) => (
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
                  {incident.status !== "RESOLU" && canCloseIncident && (
                    <button
                      className="btn-success"
                      disabled={loading}
                      onClick={() => closeIncident(incident.id)}
                    >
                      Clôturer
                    </button>
                  )}
                  {incident.status !== "RESOLU" && !canCloseIncident && <span>-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
