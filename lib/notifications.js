export const NOTIFICATION_TYPES = {
  WORKFLOW_PENDING: "WORKFLOW_PENDING",
  WORKFLOW_APPROVED: "WORKFLOW_APPROVED",
  WORKFLOW_REJECTED: "WORKFLOW_REJECTED",
  WORKFLOW_FAILED: "WORKFLOW_FAILED",
  INCIDENT_ALERT: "INCIDENT_ALERT",
};

export const NOTIFICATION_PREFERENCE_FIELDS = {
  WORKFLOW_PENDING: {
    app: "app_workflow_pending",
    email: "email_workflow_pending",
  },
  WORKFLOW_APPROVED: {
    app: "app_workflow_approved",
    email: "email_workflow_approved",
  },
  WORKFLOW_REJECTED: {
    app: "app_workflow_rejected",
    email: "email_workflow_rejected",
  },
  WORKFLOW_FAILED: {
    app: "app_workflow_failed",
    email: "email_workflow_failed",
  },
  INCIDENT_ALERT: {
    app: "app_incident_alert",
    email: "email_incident_alert",
  },
};

export const NOTIFICATION_PREFERENCE_DEFINITIONS = [
  {
    type: NOTIFICATION_TYPES.WORKFLOW_PENDING,
    title: "Demandes a valider",
    description: "Approvals et tickets a traiter selon le role approbateur.",
  },
  {
    type: NOTIFICATION_TYPES.WORKFLOW_APPROVED,
    title: "Demandes approuvees",
    description: "Retour positif sur vos demandes soumises.",
  },
  {
    type: NOTIFICATION_TYPES.WORKFLOW_REJECTED,
    title: "Demandes rejetees",
    description: "Retour negatif sur vos demandes soumises.",
  },
  {
    type: NOTIFICATION_TYPES.WORKFLOW_FAILED,
    title: "Demandes en echec",
    description: "Echecs techniques ou blocages d'application.",
  },
  {
    type: NOTIFICATION_TYPES.INCIDENT_ALERT,
    title: "Alertes incident",
    description: "Incident declare sur un actif suivi.",
  },
];

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
  if (normalized === NOTIFICATION_TYPES.INCIDENT_ALERT) return "Alerte incident";
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

export function buildNotificationPreferencePayload(raw = {}) {
  const payload = {};
  Object.values(NOTIFICATION_PREFERENCE_FIELDS).forEach((channels) => {
    payload[channels.app] = Boolean(raw[channels.app]);
    payload[channels.email] = Boolean(raw[channels.email]);
  });
  return payload;
}
