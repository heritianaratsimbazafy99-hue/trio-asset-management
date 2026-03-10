export const NOTIFICATION_TYPES = {
  WORKFLOW_PENDING: "WORKFLOW_PENDING",
  WORKFLOW_APPROVED: "WORKFLOW_APPROVED",
  WORKFLOW_REJECTED: "WORKFLOW_REJECTED",
  WORKFLOW_FAILED: "WORKFLOW_FAILED",
};

export const NOTIFICATION_STATUS = {
  UNREAD: "UNREAD",
  READ: "READ",
  ARCHIVED: "ARCHIVED",
};

export function getNotificationTypeLabel(type) {
  const normalized = String(type || "").toUpperCase();
  if (normalized === NOTIFICATION_TYPES.WORKFLOW_PENDING) return "Validation requise";
  if (normalized === NOTIFICATION_TYPES.WORKFLOW_APPROVED) return "Demande approuvée";
  if (normalized === NOTIFICATION_TYPES.WORKFLOW_REJECTED) return "Demande rejetée";
  if (normalized === NOTIFICATION_TYPES.WORKFLOW_FAILED) return "Demande en échec";
  return normalized || "-";
}

export function getNotificationStatusLabel(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === NOTIFICATION_STATUS.UNREAD) return "Non lue";
  if (normalized === NOTIFICATION_STATUS.READ) return "Lue";
  if (normalized === NOTIFICATION_STATUS.ARCHIVED) return "Archivée";
  return normalized || "-";
}

export function getNotificationStatusClassName(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === NOTIFICATION_STATUS.UNREAD) return "badge-warning";
  if (normalized === NOTIFICATION_STATUS.READ) return "badge-success";
  return "badge-danger";
}
