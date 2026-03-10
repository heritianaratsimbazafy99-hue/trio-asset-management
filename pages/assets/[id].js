import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Layout from "../../components/Layout";
import StatusBadge from "../../components/StatusBadge";
import Timeline from "../../components/Timeline";
import { supabase } from "../../lib/supabaseClient";
import {
  fetchAssetAttachments,
  saveAttachmentMetadata,
  uploadAssetAttachment,
} from "../../lib/attachmentService";
import { groupMaintenanceByMonth } from "../../lib/financeEngine";
import { evaluateAssetHealth } from "../../lib/predictiveEngine";
import {
  fetchUserDirectoryList,
  fetchUserDirectoryMapByIds,
  getUserLabelById,
} from "../../lib/userDirectory";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import { formatMGA } from "../../lib/currency";
import { getAssetCategoryLabel } from "../../lib/assetCategories";
import { getAssetConditionLabel } from "../../lib/assetConditions";
import {
  INSURANCE_TYPE_OPTIONS,
  VEHICLE_INFO_LABELS,
  VEHICLE_STATUS_OPTIONS,
  insuranceStatusLabel,
  isVehicleCategory,
  vehicleInfoValue,
} from "../../lib/vehicleInfo";

function safeText(value) {
  return String(value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getAssignedDisplayLabel(asset, usersMap) {
  const fromUser = asset?.assigned_to_user_id
    ? getUserLabelById(usersMap, asset.assigned_to_user_id)
    : "";
  if (fromUser && fromUser !== asset?.assigned_to_user_id) return fromUser;
  if (asset?.assigned_to_name) return asset.assigned_to_name;
  if (fromUser) return fromUser;
  return "-";
}

function getHistoryAssignmentLabel(row, userIdField, nameField, usersMap) {
  const userId = row?.[userIdField];
  const fromUser = userId ? getUserLabelById(usersMap, userId) : "";
  if (fromUser && fromUser !== userId) return fromUser;
  if (row?.[nameField]) return row[nameField];
  if (fromUser && fromUser !== "-") return fromUser;
  return "-";
}

const INSURANCE_TYPE_LABEL_BY_VALUE = INSURANCE_TYPE_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const VEHICLE_STATUS_LABEL_BY_VALUE = VEHICLE_STATUS_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

export default function AssetDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [asset, setAsset] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [scoringConfig, setScoringConfig] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [usersMap, setUsersMap] = useState({});
  const [userOptions, setUserOptions] = useState([]);
  const [assignToUserId, setAssignToUserId] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [assignmentHistory, setAssignmentHistory] = useState([]);

  async function fetchAll(assetId) {
    setLoading(true);
    setStatusMessage("");

    const { data: assetData } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .single();

    const [
      { data: incidentsData },
      { data: maintenanceData },
      { data: assignmentHistoryData },
      usersList,
      { profile },
    ] = await Promise.all([
      supabase
        .from("incidents")
        .select("*")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false }),
      supabase
        .from("maintenance")
        .select("*")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false }),
      supabase
        .from("asset_assignment_history")
        .select("*")
        .eq("asset_id", assetId)
        .order("changed_at", { ascending: false }),
      fetchUserDirectoryList(),
      getCurrentUserProfile(),
    ]);

    const attachmentData = await fetchAssetAttachments(assetId);
    const { data: scoreConfigData } = assetData?.company_id
      ? await supabase
          .from("company_scoring_config")
          .select("*")
          .eq("company_id", assetData.company_id)
          .single()
      : { data: null };

    setAsset(assetData);
    setIncidents(incidentsData || []);
    setMaintenance(maintenanceData || []);
    setAttachments(attachmentData || []);
    setScoringConfig(scoreConfigData || null);
    setAssignmentHistory(assignmentHistoryData || []);
    setUserOptions(usersList || []);
    setAssignToUserId(assetData?.assigned_to_user_id || "");
    setAssignedToName(assetData?.assigned_to_name || "");
    setUserRole(profile?.role || "");

    const baseMap = {};
    (usersList || []).forEach((user) => {
      baseMap[user.id] = {
        ...user,
        label: user.full_name || user.email || user.id,
      };
    });

    const requiredUserIds = [
      assetData?.assigned_to_user_id,
      ...(incidentsData || []).flatMap((item) => [item.reported_by, item.resolved_by]),
      ...(maintenanceData || []).flatMap((item) => [item.reported_by, item.completed_by]),
      ...(assignmentHistoryData || []).flatMap((item) => [
        item.previous_assigned_to,
        item.new_assigned_to,
        item.changed_by,
      ]),
    ].filter(Boolean);

    const unresolvedIds = requiredUserIds.filter((id) => !baseMap[id]);
    if (unresolvedIds.length) {
      const extraMap = await fetchUserDirectoryMapByIds(unresolvedIds);
      Object.assign(baseMap, extraMap);
    }
    setUsersMap(baseMap);
    setLoading(false);
  }

  useEffect(() => {
    if (!id) return;
    fetchAll(id);
  }, [id]);

  const analysis = useMemo(
    () =>
      evaluateAssetHealth({
        asset,
        incidents,
        maintenance,
        scoringConfig,
      }),
    [asset, incidents, maintenance, scoringConfig]
  );

  const maintenanceTrend = useMemo(
    () => groupMaintenanceByMonth(maintenance, 12),
    [maintenance]
  );
  const canManageAssignment = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.DAF,
    APP_ROLES.RESPONSABLE,
  ]);
  const canEditPurchaseValue = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.DAF,
    APP_ROLES.RESPONSABLE,
  ]);
  const isVehicleAsset = isVehicleCategory(asset?.category);
  const vehicleDetails =
    asset?.vehicle_details && typeof asset.vehicle_details === "object"
      ? asset.vehicle_details
      : {};
  const insuranceTypeValue = vehicleInfoValue(vehicleDetails, "insurance_type", "");
  const insuranceTypeLabel =
    INSURANCE_TYPE_LABEL_BY_VALUE[insuranceTypeValue] || insuranceTypeValue || "-";
  const vehicleStatusValue = vehicleInfoValue(vehicleDetails, "vehicle_operational_status", "");
  const vehicleStatusLabel =
    VEHICLE_STATUS_LABEL_BY_VALUE[vehicleStatusValue] || vehicleStatusValue || "-";
  const insuranceStatus = insuranceStatusLabel(vehicleInfoValue(vehicleDetails, "insurance_status", ""));

  const timelineItems = useMemo(() => {
    const incidentItems = incidents.map((item) => ({
      id: `incident-${item.id}`,
      type: "incident",
      title: item.title || item.description || "Incident",
      created_at: item.created_at,
      status: item.status,
      reportedBy: getUserLabelById(usersMap, item.reported_by),
      closedBy: getUserLabelById(usersMap, item.resolved_by),
      closedAt: item.resolved_at,
    }));
    const maintenanceItems = maintenance.map((item) => ({
      id: `maintenance-${item.id}`,
      type: "maintenance",
      title: item.title || item.description || "Maintenance",
      created_at: item.created_at || item.date,
      status: item.status,
      reportedBy: getUserLabelById(usersMap, item.reported_by),
      closedBy: getUserLabelById(usersMap, item.completed_by),
      closedAt: item.completed_at,
    }));

    return [...incidentItems, ...maintenanceItems].sort((a, b) => {
      const d1 = new Date(a.created_at || 0).getTime();
      const d2 = new Date(b.created_at || 0).getTime();
      return d2 - d1;
    });
  }, [incidents, maintenance, usersMap]);

  async function handleAttachmentUpload(event) {
    setAttachmentError("");
    const file = event.target.files?.[0];
    if (!file || !asset?.id) return;

    try {
      setAttachmentBusy(true);
      const uploaded = await uploadAssetAttachment({ assetId: asset.id, file });
      await saveAttachmentMetadata({
        assetId: asset.id,
        fileName: uploaded.fileName,
        path: uploaded.path,
        publicUrl: uploaded.publicUrl,
        thumbnailPath: uploaded.thumbnailPath,
        thumbnailUrl: uploaded.thumbnailUrl,
      });
      const updated = await fetchAssetAttachments(asset.id);
      setAttachments(updated || []);
    } catch (error) {
      setAttachmentError(
        `Upload impossible. Verifiez le bucket storage "asset-documents" et la table "asset_attachments". (${error.message})`
      );
    } finally {
      setAttachmentBusy(false);
      event.target.value = "";
    }
  }

  async function applyAutomaticAssetStatus() {
    if (!asset?.id) return;
    setStatusBusy(true);
    setStatusMessage("");

    const hasOpenIncident = incidents.some((item) => item.status !== "RESOLU");
    const hasPendingMaintenance = maintenance.some(
      (item) => !item.is_completed && item.status !== "TERMINEE"
    );
    const nextStatus = hasOpenIncident || hasPendingMaintenance
      ? "EN_MAINTENANCE"
      : "EN_SERVICE";

    const { error } = await supabase
      .from("assets")
      .update({ status: nextStatus })
      .eq("id", asset.id);

    if (error) {
      setStatusMessage(`Erreur mise à jour statut: ${error.message}`);
    } else {
      setStatusMessage(`Statut mis à jour automatiquement: ${nextStatus}`);
      setAsset((prev) => (prev ? { ...prev, status: nextStatus } : prev));
    }

    setStatusBusy(false);
  }

  async function updateAssetAssignment() {
    if (!asset?.id) return;
    if (!canManageAssignment) {
      setStatusMessage("Action refusée: seul CEO/DAF/RESPONSABLE peut modifier 'Attribué à'.");
      return;
    }
    setAssignBusy(true);
    setStatusMessage("");
    let successMessage = "Attribution mise à jour.";

    const selectedUser = userOptions.find((user) => user.id === assignToUserId);
    const assignedNameFromUser = selectedUser
      ? (selectedUser.full_name || selectedUser.label || selectedUser.email || selectedUser.id || "")
      : "";
    const assignedName = assignedToName.trim() || assignedNameFromUser || null;

    let { error } = await supabase
      .from("assets")
      .update({
        assigned_to_user_id: assignToUserId || null,
        assigned_to_name: assignedName,
      })
      .eq("id", asset.id);

    if (error && String(error.message || "").toLowerCase().includes("assigned_to_name")) {
      const fallback = await supabase
        .from("assets")
        .update({ assigned_to_user_id: assignToUserId || null })
        .eq("id", asset.id);
      error = fallback.error;
      if (!fallback.error) {
        successMessage =
          "Attribution utilisateur mise à jour. Pour stocker le nom libre, execute la migration SQL assigned_to_name."
      }
    }

    if (error) {
      setStatusMessage(`Erreur mise à jour attribution: ${error.message}`);
    } else {
      setStatusMessage(successMessage);
      await fetchAll(asset.id);
    }

    setAssignBusy(false);
  }

  function generateAssetPdf() {
    if (!asset || typeof window === "undefined") return;

    const incidentsRows = incidents.length
      ? incidents
          .map(
            (item) =>
              `<tr><td>${safeText(item.title || item.description)}</td><td>${safeText(
                item.status
              )}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="2">Aucun incident</td></tr>`;

    const maintenanceRows = maintenance.length
      ? maintenance
          .map(
            (item) =>
              `<tr><td>${safeText(item.title || item.description)}</td><td>${formatMGA(
                item.cost
              )}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="2">Aucune maintenance</td></tr>`;

    const scheduleRows = analysis.schedule.length
      ? analysis.schedule
          .map(
            (row) =>
              `<tr><td>${row.year}</td><td>${row.method}</td><td>${formatMGA(
                row.annual
              )}</td><td>${formatMGA(row.cumulative)}</td><td>${formatMGA(
                row.vncEnd
              )}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="5">Pas assez d'informations</td></tr>`;

    const popup = window.open("", "_blank", "width=980,height=900");
    if (!popup) {
      window.alert("Autorisez les popups pour generer le PDF.");
      return;
    }

    popup.document.write(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Fiche actif - ${safeText(asset.name)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
    h1, h2 { margin: 0 0 12px 0; }
    p { margin: 6px 0; }
    .block { margin-top: 22px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
    th { background: #f8fafc; }
    .highlight { margin-top: 10px; padding: 10px; border-radius: 8px; background: ${
      analysis.rentable ? "#dcfce7" : "#fee2e2"
    }; }
  </style>
</head>
<body>
  <h1>Fiche immobilisation: ${safeText(asset.name)}</h1>
  <p><strong>Code:</strong> ${safeText(asset.code || asset.serial_number)}</p>
  <p><strong>Categorie:</strong> ${safeText(getAssetCategoryLabel(asset.category))}</p>
  <p><strong>Etat actuel:</strong> ${safeText(getAssetConditionLabel(asset.current_condition))}</p>
  <p><strong>Date achat:</strong> ${safeText(asset.purchase_date)}</p>
  <p><strong>Attribue a:</strong> ${safeText(getAssignedDisplayLabel(asset, usersMap))}</p>
  <p><strong>Type amortissement:</strong> ${safeText(asset.amortissement_type)}</p>
  <p><strong>Valeur achat:</strong> ${formatMGA(analysis.purchaseValue)}</p>
  <p><strong>VNC actuelle:</strong> ${formatMGA(analysis.vnc)}</p>
  <p><strong>Total maintenance:</strong> ${formatMGA(analysis.totalMaintenance)}</p>
  <p><strong>Ratio maintenance/valeur:</strong> ${analysis.maintenanceRatio.toFixed(1)}%</p>
  <div class="highlight"><strong>Recommendation:</strong> ${safeText(
    analysis.recommendation
  )}</div>

  <div class="block">
    <h2>Tableau d'amortissement</h2>
    <table>
      <thead><tr><th>Annee</th><th>Methode</th><th>Dotation</th><th>Cumule</th><th>VNC fin</th></tr></thead>
      <tbody>${scheduleRows}</tbody>
    </table>
  </div>

  <div class="block">
    <h2>Incidents</h2>
    <table>
      <thead><tr><th>Titre</th><th>Statut</th></tr></thead>
      <tbody>${incidentsRows}</tbody>
    </table>
  </div>

  <div class="block">
    <h2>Maintenance</h2>
    <table>
      <thead><tr><th>Titre</th><th>Cout</th></tr></thead>
      <tbody>${maintenanceRows}</tbody>
    </table>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`);
    popup.document.close();
  }

  if (loading) return <Layout><p>Chargement...</p></Layout>;
  if (!asset) return <Layout><p>Actif introuvable.</p></Layout>;

  return (
    <Layout>
      <h1>{asset.name}</h1>
      <div style={{ marginBottom: 12 }}>
        <button className="btn-secondary" onClick={() => router.push("/assets")}>
          Retour a la liste des immobilisations
        </button>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Valeur d'achat</h3>
          <p>{formatMGA(analysis.purchaseValue)}</p>
        </div>
        <div className="card">
          <h3>VNC actuelle</h3>
          <p>{formatMGA(analysis.vnc)}</p>
        </div>
        <div className="card">
          <h3>Total maintenance</h3>
          <p>{formatMGA(analysis.totalMaintenance)}</p>
        </div>
        <div className="card">
          <h3>Maintenance / Valeur</h3>
          <p>{analysis.maintenanceRatio.toFixed(1)} %</p>
        </div>
        <div className="card">
          <h3>Score actif</h3>
          <p>{analysis.score}/100</p>
        </div>
        <div className="card">
          <h3>Decision</h3>
          <p>{analysis.recommendation}</p>
        </div>
      </div>

      <div className="card">
        <p><strong>Code:</strong> {asset.code || asset.serial_number || "-"}</p>
        <p><strong>Categorie:</strong> {getAssetCategoryLabel(asset.category)}</p>
        <p><strong>Etat actuel:</strong> {getAssetConditionLabel(asset.current_condition)}</p>
        <p><strong>Valeur d'achat:</strong> {formatMGA(asset.purchase_value ?? asset.value ?? 0)}</p>
        <p><strong>Date d'achat:</strong> {asset.purchase_date || "-"}</p>
        <p><strong>Statut:</strong> <StatusBadge status={asset.status} /></p>
        <p><strong>Attribué à:</strong> {getAssignedDisplayLabel(asset, usersMap)}</p>
        <p><strong>Type amortissement:</strong> {asset.amortissement_type || "-"}</p>
        <p><strong>Duree:</strong> {analysis.duration || "-"} ans</p>
        <p><strong>Incidents 12 mois:</strong> {analysis.incidentCount12m}</p>
        <p><strong>Incidents 30 jours:</strong> {analysis.incidentCount30d}</p>
        <p><strong>Maintenance en retard:</strong> {analysis.overdueMaintenanceCount}</p>
        {analysis.alerts.length > 0 && (
          <div className="alert-warning" style={{ marginTop: 12 }}>
            {analysis.alerts.map((item) => (
              <div key={item}>- {item}</div>
            ))}
          </div>
        )}
        {statusMessage && (
          <div className="alert-warning" style={{ marginTop: 12 }}>
            {statusMessage}
          </div>
        )}

        {canManageAssignment ? (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.2fr 1fr auto", gap: 10 }}>
            <input
              className="input"
              value={assignedToName}
              placeholder="Nom de la personne attribuée"
              onChange={(e) => setAssignedToName(e.target.value)}
            />
            <select
              className="select"
              value={assignToUserId}
              onChange={(e) => {
                const nextId = e.target.value;
                setAssignToUserId(nextId);
                if (!nextId) return;
                const selected = userOptions.find((user) => user.id === nextId);
                const label = selected?.full_name || selected?.label || selected?.email || "";
                if (label) setAssignedToName(label);
              }}
            >
              <option value="">Aucun utilisateur lié</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.email || user.id}
                </option>
              ))}
            </select>
            <button className="btn-secondary" onClick={updateAssetAssignment} disabled={assignBusy}>
              {assignBusy ? "Mise à jour..." : "Mettre à jour attribution"}
            </button>
          </div>
        ) : (
          <div className="alert-warning" style={{ marginTop: 12 }}>
            Modification de l'attribution réservée aux rôles CEO, DAF et RESPONSABLE.
          </div>
        )}

        <div style={{ marginTop: 15, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canEditPurchaseValue && (
            <button
              className="btn-secondary"
              onClick={() => router.push(`/assets/edit/${asset.id}`)}
            >
              Modifier actif
            </button>
          )}
          <button
            className="btn-secondary"
            onClick={() => router.push(`/assets/${asset.id}/journal`)}
          >
            Voir journal actif
          </button>
          <button
            className="btn-primary"
            onClick={() => router.push(`/incidents/new?asset_id=${asset.id}`)}
          >
            + Incident
          </button>
          <button
            className="btn-warning"
            onClick={() => router.push(`/maintenance/new?asset_id=${asset.id}`)}
          >
            + Maintenance
          </button>
          <button className="btn-secondary" onClick={generateAssetPdf}>
            Generer PDF fiche actif
          </button>
          <button
            className="btn-success"
            disabled={statusBusy}
            onClick={applyAutomaticAssetStatus}
          >
            {statusBusy ? "Mise à jour..." : "Statut auto selon incidents/maintenance"}
          </button>
        </div>
      </div>

      {isVehicleAsset && (
        <div className="card">
          <h3>Données véhicule (moto / voiture)</h3>

          <div className="vehicle-detail-grid">
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.registration_number}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "registration_number")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.brand}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "brand")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.model}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "model")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.engine_displacement}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "engine_displacement")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.chassis_number}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "chassis_number")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.color}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "color")}</strong>
            </div>
          </div>

          <h4 style={{ marginTop: 14, marginBottom: 8 }}>Affectation</h4>
          <div className="vehicle-detail-grid">
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.assigned_agent_name}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "assigned_agent_name")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.assigned_agent_contact}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "assigned_agent_contact")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.assigned_agent_id_number}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "assigned_agent_id_number")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.assigned_agent_function}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "assigned_agent_function")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.assignment_region}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "assignment_region")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.vehicle_operational_status}</span>
              <strong>{vehicleStatusLabel}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.manager_name}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "manager_name")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.manager_contact}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "manager_contact")}</strong>
            </div>
          </div>

          <h4 style={{ marginTop: 14, marginBottom: 8 }}>Assurance et documents</h4>
          <div className="vehicle-detail-grid">
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.insurance_company}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "insurance_company")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.insurance_type}</span>
              <strong>{insuranceTypeLabel}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.policy_number}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "policy_number")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.insurance_start_date}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "insurance_start_date")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.insurance_end_date}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "insurance_end_date")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.insurance_status}</span>
              <strong>{insuranceStatus}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.registration_card_number}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "registration_card_number")}</strong>
            </div>
            <div className="vehicle-detail-item">
              <span className="vehicle-detail-label">{VEHICLE_INFO_LABELS.registration_card_date}</span>
              <strong>{vehicleInfoValue(vehicleDetails, "registration_card_date")}</strong>
            </div>
          </div>
        </div>
      )}

      <div className="chart-grid">
        <div className="card">
          <h3>Courbe VNC et amortissement</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={analysis.schedule}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip formatter={(value) => formatMGA(value)} />
              <Line type="monotone" dataKey="vncEnd" stroke="#0b3d91" name="VNC fin annee" />
              <Line type="monotone" dataKey="annual" stroke="#0a8f87" name="Dotation annuelle" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Evolution cout maintenance (12 mois)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={maintenanceTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => formatMGA(value)} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" name="Maintenance" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>Tableau d'amortissement (pro)</h3>
        {analysis.schedule.length === 0 ? (
          <p>Pas assez d'informations pour calculer.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Annee</th>
                <th>Methode</th>
                <th>Dotation annuelle</th>
                <th>Amort. cumule</th>
                <th>VNC debut</th>
                <th>VNC fin</th>
              </tr>
            </thead>
            <tbody>
              {analysis.schedule.map((row) => (
                <tr key={`${row.year}-${row.yearIndex}`}>
                  <td>{row.year}</td>
                  <td>{row.method}</td>
                  <td>{formatMGA(row.annual)}</td>
                  <td>{formatMGA(row.cumulative)}</td>
                  <td>{formatMGA(row.vncStart)}</td>
                  <td>{formatMGA(row.vncEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Timeline items={timelineItems} />

      <div className="card">
        <h3>Historique des attributions</h3>
        {assignmentHistory.length === 0 ? (
          <p>Aucun changement d'attribution enregistré.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ancienne attribution</th>
                <th>Nouvelle attribution</th>
                <th>Modifié par</th>
              </tr>
            </thead>
            <tbody>
              {assignmentHistory.map((item) => (
                <tr key={`assignment-${item.id}`}>
                  <td>{item.changed_at ? new Date(item.changed_at).toLocaleString("fr-FR") : "-"}</td>
                  <td>{getHistoryAssignmentLabel(item, "previous_assigned_to", "previous_assigned_name", usersMap)}</td>
                  <td>{getHistoryAssignmentLabel(item, "new_assigned_to", "new_assigned_name", usersMap)}</td>
                  <td>{getUserLabelById(usersMap, item.changed_by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Historique incidents</h3>
        {incidents.length === 0 ? (
          <p>Aucun incident.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Titre</th>
                <th>Statut</th>
                <th>Signalé par</th>
                <th>Signalé le</th>
                <th>Clôturé par</th>
                <th>Date clôture</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((item) => (
                <tr key={`incident-history-${item.id}`}>
                  <td>{item.title || item.description || "-"}</td>
                  <td>{item.status || "-"}</td>
                  <td>{getUserLabelById(usersMap, item.reported_by)}</td>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleDateString("fr-FR") : "-"}</td>
                  <td>{getUserLabelById(usersMap, item.resolved_by)}</td>
                  <td>{item.resolved_at ? new Date(item.resolved_at).toLocaleDateString("fr-FR") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Historique maintenance</h3>
        {maintenance.length === 0 ? (
          <p>Aucune maintenance.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Titre</th>
                <th>Coût</th>
                <th>Statut</th>
                <th>Signalé par</th>
                <th>Signalé le</th>
                <th>Clôturé par</th>
                <th>Date clôture</th>
              </tr>
            </thead>
            <tbody>
              {maintenance.map((item) => (
                <tr key={`maintenance-history-${item.id}`}>
                  <td>{item.title || item.description || "-"}</td>
                  <td>{formatMGA(item.cost)}</td>
                  <td>{item.status || "-"}</td>
                  <td>{getUserLabelById(usersMap, item.reported_by)}</td>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleDateString("fr-FR") : "-"}</td>
                  <td>{getUserLabelById(usersMap, item.completed_by)}</td>
                  <td>{item.completed_at ? new Date(item.completed_at).toLocaleDateString("fr-FR") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Pieces jointes</h3>
        {attachmentError && <div className="alert-error">{attachmentError}</div>}
        <div style={{ marginBottom: 14 }}>
          <input type="file" className="input" onChange={handleAttachmentUpload} />
          <small style={{ display: "block", marginTop: 6, color: "#5f6f83" }}>
            Taille max: 10 MB. Les images sont converties en WebP + miniature avant envoi.
          </small>
          {attachmentBusy && <p style={{ marginTop: 8 }}>Upload en cours...</p>}
        </div>

        {attachments.length === 0 ? (
          <p>Aucune piece jointe.</p>
        ) : (
          <>
            {attachments.some((item) => item.thumbnail_url) && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                {attachments
                  .filter((item) => item.thumbnail_url)
                  .map((item) => (
                    <a
                      key={`thumb-${item.id}`}
                      href={item.file_url}
                      target="_blank"
                      rel="noreferrer"
                      title={item.file_name || "Image"}
                      style={{
                        border: "1px solid #d6dfeb",
                        borderRadius: 10,
                        padding: 6,
                        display: "block",
                        background: "#fff",
                      }}
                    >
                      <img
                        src={item.thumbnail_url}
                        alt={item.file_name || "Miniature"}
                        loading="lazy"
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          objectFit: "cover",
                          borderRadius: 8,
                          display: "block",
                        }}
                      />
                    </a>
                  ))}
              </div>
            )}

            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a href={item.file_url} target="_blank" rel="noreferrer">
                        {item.file_name || "Document"}
                      </a>
                    </td>
                    <td>
                      {item.created_at
                        ? new Date(item.created_at).toLocaleDateString("fr-FR")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Layout>
  );
}
