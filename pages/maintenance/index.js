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

function getMaintenanceDisplayStatus(item) {
  const approvalStatus = String(item?.approval_status || "").toUpperCase();
  const status = String(item?.status || "").toUpperCase();

  if (approvalStatus === "REJETEE") return "Rejetée";
  if (approvalStatus === "EN_ATTENTE_VALIDATION" || status === "EN_ATTENTE_VALIDATION") {
    return "En attente de validation";
  }
  if (item?.is_completed || status === "TERMINEE") return "Terminée";
  if (status === "EN_COURS") return "En cours";
  return "Planifiée";
}

function getMaintenanceStatusClassName(item) {
  const approvalStatus = String(item?.approval_status || "").toUpperCase();
  const status = String(item?.status || "").toUpperCase();

  if (approvalStatus === "REJETEE") return "badge-danger";
  if (approvalStatus === "EN_ATTENTE_VALIDATION" || status === "EN_ATTENTE_VALIDATION") {
    return "badge-warning";
  }
  if (item?.is_completed || status === "TERMINEE") return "badge-success";
  return "badge-warning";
}

export default function MaintenancePage() {
  const router = useRouter();
  const [maintenance, setMaintenance] = useState([]);
  const [replacementAssets, setReplacementAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [error, setError] = useState("");
  const [usersMap, setUsersMap] = useState({});

  const canCloseMaintenance = hasOneRole(userRole, OPERATIONAL_LEADERSHIP_ROLES);

  async function fetchData() {
    const [{ data }, { data: replacementData }, { profile }] = await Promise.all([
      supabase
      .from("maintenance")
      .select("*, assets(name)")
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

  async function markCompleted(id) {
    if (!canCloseMaintenance) {
      setError("Seuls le CEO, le DAF et les responsables maintenance peuvent cloturer.");
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
                      {getMaintenanceDisplayStatus(m)}
                    </span>
                  </td>

                  <td>
                    {!m.is_completed &&
                      String(m.approval_status || "").toUpperCase() !== "REJETEE" &&
                      String(m.status || "").toUpperCase() !== "EN_ATTENTE_VALIDATION" &&
                      canCloseMaintenance && (
                      <button
                        className="btn-success"
                        disabled={loading}
                        onClick={() => markCompleted(m.id)}
                      >
                        Marquer terminée
                      </button>
                    )}
                    {!m.is_completed &&
                      String(m.approval_status || "").toUpperCase() !== "REJETEE" &&
                      String(m.status || "").toUpperCase() !== "EN_ATTENTE_VALIDATION" &&
                      !canCloseMaintenance && <span>-</span>}
                    {(String(m.approval_status || "").toUpperCase() === "REJETEE" ||
                      String(m.status || "").toUpperCase() === "EN_ATTENTE_VALIDATION") && (
                      <span>-</span>
                    )}
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
