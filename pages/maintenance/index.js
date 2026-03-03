import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import {
  APP_ROLES,
  getCurrentUserProfile,
  hasOneRole,
} from "../../lib/accessControl";
import {
  fetchUserDirectoryMapByIds,
  getUserLabelById,
} from "../../lib/userDirectory";

function formatEUR(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

function computeSlaStatus(item) {
  if (item.is_completed || item.status === "TERMINEE") return "TERMINEE";
  if (!item.due_date) return "SANS_DELAI";
  const now = Date.now();
  const dueTs = new Date(item.due_date).getTime();
  if (!Number.isFinite(dueTs)) return "SANS_DELAI";
  if (dueTs < now) return "EN_RETARD";
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (dueTs - now <= 2 * oneDayMs) return "A_RISQUE";
  return "OK";
}

export default function MaintenancePage() {
  const [maintenance, setMaintenance] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [error, setError] = useState("");
  const [usersMap, setUsersMap] = useState({});

  const canCloseMaintenance = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.RESPONSABLE_MAINTENANCE,
  ]);

  async function fetchData() {
    const [{ data }, { profile }] = await Promise.all([
      supabase
      .from("maintenance")
      .select("*, assets(name)")
      .order("created_at", { ascending: false }),
      getCurrentUserProfile(),
    ]);

    setUserRole(profile?.role || "");
    setMaintenance(data || []);
    const ids = (data || []).flatMap((item) => [item.reported_by, item.completed_by]).filter(Boolean);
    const map = await fetchUserDirectoryMapByIds(ids);
    setUsersMap(map);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function markCompleted(id) {
    if (!canCloseMaintenance) {
      setError("Seuls le CEO et les responsables maintenance peuvent cloturer.");
      return;
    }

    setLoading(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: updateError } = await supabase
      .from("maintenance")
      .update({
        is_completed: true,
        status: "TERMINEE",
        completed_at: new Date().toISOString(),
        completed_by: user?.id || null,
      })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
    }

    await fetchData();
    setLoading(false);
  }

  return (
    <Layout>
      <h1>Maintenance</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>
      {error && <div className="alert-error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Actif</th>
              <th>Titre</th>
              <th>Coût</th>
              <th>Priorité</th>
              <th>Deadline</th>
              <th>SLA</th>
              <th>Signalé par</th>
              <th>Clôturé par</th>
              <th>Date clôture</th>
              <th>Statut</th>
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
                <td>{formatEUR(m.cost)}</td>
                <td>{m.priority || "-"}</td>
                <td>
                  {m.due_date
                    ? new Date(m.due_date).toLocaleDateString("fr-FR")
                    : "-"}
                </td>
                <td>
                  <span className={`sla-badge ${computeSlaStatus(m).toLowerCase()}`}>
                    {computeSlaStatus(m)}
                  </span>
                </td>
                <td>{getUserLabelById(usersMap, m.reported_by)}</td>
                <td>{getUserLabelById(usersMap, m.completed_by)}</td>
                <td>
                  {m.completed_at
                    ? new Date(m.completed_at).toLocaleDateString("fr-FR")
                    : "-"}
                </td>

                <td>
                  {m.is_completed ? (
                    <span className="badge-success">Terminée</span>
                  ) : (
                    <span className="badge-warning">Planifiée</span>
                  )}
                </td>

                <td>
                  {!m.is_completed && canCloseMaintenance && (
                    <button
                      className="btn-success"
                      disabled={loading}
                      onClick={() => markCompleted(m.id)}
                    >
                      Marquer terminée
                    </button>
                  )}
                  {!m.is_completed && !canCloseMaintenance && <span>-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
