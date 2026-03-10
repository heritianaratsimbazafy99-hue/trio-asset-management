import { formatMGA } from "./currency";
import { APP_ROLES, hasOneRole, normalizeRole } from "./accessControl";

export const WORKFLOW_REQUEST_TYPES = {
  ASSET_DELETE: "ASSET_DELETE",
  ASSET_PURCHASE_VALUE_CHANGE: "ASSET_PURCHASE_VALUE_CHANGE",
  MAINTENANCE_START: "MAINTENANCE_START",
  ASSET_REBUS: "ASSET_REBUS",
};

export const WORKFLOW_REQUEST_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
};

export function canRequestAssetDeletion(profileRole) {
  return Boolean(normalizeRole(profileRole));
}

export function canDirectlyDeleteAsset(profileRole) {
  return hasOneRole(profileRole, [APP_ROLES.CEO]);
}

export function canRequestPurchaseValueChange(profileRole) {
  return Boolean(normalizeRole(profileRole));
}

export function canDirectlyChangePurchaseValue(profileRole) {
  return hasOneRole(profileRole, [APP_ROLES.CEO]);
}

export function canRequestAssetRebus(profileRole) {
  return hasOneRole(profileRole, [
    APP_ROLES.CEO,
    APP_ROLES.RESPONSABLE_MAINTENANCE,
  ]);
}

export function getWorkflowRequestTypeLabel(type) {
  const normalized = String(type || "").toUpperCase();
  if (normalized === WORKFLOW_REQUEST_TYPES.ASSET_DELETE) {
    return "Suppression d'actif";
  }
  if (normalized === WORKFLOW_REQUEST_TYPES.ASSET_PURCHASE_VALUE_CHANGE) {
    return "Changement valeur comptable";
  }
  if (normalized === WORKFLOW_REQUEST_TYPES.MAINTENANCE_START) {
    return "Validation maintenance";
  }
  if (normalized === WORKFLOW_REQUEST_TYPES.ASSET_REBUS) {
    return "Passage en rebus";
  }
  return normalized || "-";
}

export function getWorkflowStatusLabel(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === WORKFLOW_REQUEST_STATUS.PENDING) return "En attente";
  if (normalized === WORKFLOW_REQUEST_STATUS.APPROVED) return "Approuvée";
  if (normalized === WORKFLOW_REQUEST_STATUS.REJECTED) return "Rejetée";
  if (normalized === WORKFLOW_REQUEST_STATUS.FAILED) return "En échec";
  return normalized || "-";
}

export function getWorkflowStatusClassName(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === WORKFLOW_REQUEST_STATUS.APPROVED) return "badge-success";
  if (normalized === WORKFLOW_REQUEST_STATUS.PENDING) return "badge-warning";
  return "badge-danger";
}

export function getWorkflowPayloadSummary(request) {
  const type = String(request?.request_type || "").toUpperCase();
  const payload = request?.payload || {};

  if (type === WORKFLOW_REQUEST_TYPES.ASSET_DELETE) {
    return request?.reason || "Suppression définitive demandée";
  }

  if (type === WORKFLOW_REQUEST_TYPES.ASSET_PURCHASE_VALUE_CHANGE) {
    const oldValue = Number(
      payload?.old_effective_purchase_value ?? payload?.old_purchase_value ?? payload?.old_value ?? 0
    );
    const newValue = Number(
      payload?.new_effective_purchase_value ?? payload?.new_purchase_value ?? payload?.new_value ?? 0
    );
    return `${formatMGA(oldValue)} -> ${formatMGA(newValue)}`;
  }

  if (type === WORKFLOW_REQUEST_TYPES.MAINTENANCE_START) {
    const cost = Number(payload?.cost ?? 0);
    return `${payload?.title || "Maintenance"} | ${formatMGA(cost)}`;
  }

  if (type === WORKFLOW_REQUEST_TYPES.ASSET_REBUS) {
    return request?.reason || "Signalement irréparable";
  }

  return request?.reason || "-";
}
