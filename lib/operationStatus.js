export function normalizeOperationStatus(value) {
  return String(value || "").trim().toUpperCase();
}

export function isIncidentOpen(incident) {
  if (!incident) return false;
  return normalizeOperationStatus(incident?.status) !== "RESOLU";
}

export function isMaintenanceRejected(item) {
  return normalizeOperationStatus(item?.approval_status) === "REJETEE";
}

export function isMaintenanceCompleted(item) {
  return Boolean(item?.is_completed) || normalizeOperationStatus(item?.status) === "TERMINEE";
}

export function isMaintenancePendingApproval(item) {
  return (
    !isMaintenanceCompleted(item) &&
    !isMaintenanceRejected(item) &&
    (normalizeOperationStatus(item?.approval_status) === "EN_ATTENTE_VALIDATION" ||
      normalizeOperationStatus(item?.status) === "EN_ATTENTE_VALIDATION")
  );
}

export function isMaintenanceBlockingAsset(item) {
  if (!item) return false;
  return !isMaintenanceCompleted(item) && !isMaintenanceRejected(item);
}

export function getMaintenanceDisplayStatus(item) {
  const approvalStatus = normalizeOperationStatus(item?.approval_status);
  const status = normalizeOperationStatus(item?.status);

  if (approvalStatus === "REJETEE") return "REJETEE";
  if (approvalStatus === "EN_ATTENTE_VALIDATION" || status === "EN_ATTENTE_VALIDATION") {
    return "EN_ATTENTE_VALIDATION";
  }
  if (isMaintenanceCompleted(item)) return "TERMINEE";
  if (status === "EN_COURS") return "EN_COURS";
  return status || "PLANIFIEE";
}

export function getMaintenanceStatusLabel(item) {
  const status = getMaintenanceDisplayStatus(item);
  if (status === "REJETEE") return "Rejetée";
  if (status === "EN_ATTENTE_VALIDATION") return "En attente validation";
  if (status === "TERMINEE") return "Terminée";
  if (status === "EN_COURS") return "En cours";
  return "Planifiée";
}

export function getMaintenanceStatusClassName(item) {
  const status = getMaintenanceDisplayStatus(item);
  if (status === "REJETEE") return "badge-danger";
  if (status === "TERMINEE") return "badge-success";
  return "badge-warning";
}

export function getIncidentStatusLabel(status) {
  const normalized = normalizeOperationStatus(status);
  if (normalized === "RESOLU") return "Résolu";
  if (normalized === "EN_COURS") return "En cours";
  if (normalized === "OUVERT") return "Ouvert";
  return normalized || "-";
}

export function getBlockingOperationsSummary({ incidents = [], maintenance = [] } = {}) {
  const openIncidents = incidents.filter(isIncidentOpen);
  const blockingMaintenance = maintenance.filter(isMaintenanceBlockingAsset);
  const pendingMaintenance = blockingMaintenance.filter(isMaintenancePendingApproval);
  const activeMaintenance = blockingMaintenance.filter(
    (item) => !isMaintenancePendingApproval(item)
  );

  return {
    openIncidents,
    blockingMaintenance,
    pendingMaintenance,
    activeMaintenance,
    hasBlockingOperations: openIncidents.length > 0 || blockingMaintenance.length > 0,
  };
}

export function getDerivedAssetStatus({ asset, incidents = [], maintenance = [] } = {}) {
  if (normalizeOperationStatus(asset?.status) === "REBUS") {
    return "REBUS";
  }

  const summary = getBlockingOperationsSummary({ incidents, maintenance });
  return summary.hasBlockingOperations ? "EN_MAINTENANCE" : "EN_SERVICE";
}
