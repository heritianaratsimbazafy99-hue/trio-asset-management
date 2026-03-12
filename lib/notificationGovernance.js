import { APP_ROLES } from "./accessControl";

export const NOTIFICATION_REQUEST_TYPES = {
  ANY: "ANY",
  ASSET_DELETE: "ASSET_DELETE",
  ASSET_PURCHASE_VALUE_CHANGE: "ASSET_PURCHASE_VALUE_CHANGE",
  MAINTENANCE_START: "MAINTENANCE_START",
  ASSET_REBUS: "ASSET_REBUS",
};

export const NOTIFICATION_CHANNELS = {
  APP: "APP",
  EMAIL: "EMAIL",
};

export const NOTIFICATION_ROUTING_ROLES = [
  APP_ROLES.CEO,
  APP_ROLES.DAF,
  APP_ROLES.RESPONSABLE,
  APP_ROLES.RESPONSABLE_MAINTENANCE,
];

export const NOTIFICATION_ROUTING_SCENARIOS = [
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.ASSET_DELETE,
    title: "Suppression d'actif",
    description: "Demandes de suppression d'actif en attente de décision.",
    allowedRoles: [APP_ROLES.CEO],
  },
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.ASSET_PURCHASE_VALUE_CHANGE,
    title: "Changement de valeur d'achat",
    description: "Demandes de changement de valeur d'achat en attente.",
    allowedRoles: [APP_ROLES.CEO],
  },
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.MAINTENANCE_START,
    title: "Ticket maintenance",
    description: "Tickets maintenance en attente de validation CEO/DAF/Resp. maintenance.",
    allowedRoles: [APP_ROLES.CEO, APP_ROLES.DAF, APP_ROLES.RESPONSABLE_MAINTENANCE],
  },
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.ASSET_REBUS,
    title: "Passage en rebus",
    description: "Demandes de passage en rebus d'actifs irréparables.",
    allowedRoles: [
      APP_ROLES.CEO,
      APP_ROLES.DAF,
      APP_ROLES.RESPONSABLE,
      APP_ROLES.RESPONSABLE_MAINTENANCE,
    ],
  },
  {
    notificationType: "INCIDENT_ALERT",
    requestType: NOTIFICATION_REQUEST_TYPES.ANY,
    title: "Alerte incident",
    description: "Incidents déclarés sur les actifs suivis.",
    allowedRoles: NOTIFICATION_ROUTING_ROLES,
  },
];

export const NOTIFICATION_TEMPLATE_SCENARIOS = [
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.ASSET_DELETE,
    label: "Validation suppression d'actif",
    emailSubjectTemplate: "Validation requise - suppression d'actif {{asset_name}}",
    titleTemplate: "Validation requise - suppression d'actif",
    bodyTemplate:
      "Une demande de suppression d'actif attend votre décision pour {{asset_name}}. Motif: {{reason}}",
    ctaLabel: "Traiter la demande",
  },
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.ASSET_PURCHASE_VALUE_CHANGE,
    label: "Validation valeur d'achat",
    emailSubjectTemplate: "Validation requise - valeur d'achat {{asset_name}}",
    titleTemplate: "Validation requise - valeur d'achat",
    bodyTemplate:
      "Une demande de changement de valeur d'achat attend votre décision pour {{asset_name}}. Motif: {{reason}}",
    ctaLabel: "Traiter la demande",
  },
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.MAINTENANCE_START,
    label: "Validation ticket maintenance",
    emailSubjectTemplate: "Validation requise - ticket maintenance {{asset_name}}",
    titleTemplate: "Validation requise - ticket maintenance",
    bodyTemplate:
      "Un ticket maintenance attend votre décision pour {{asset_name}}. Objet: {{title}}",
    ctaLabel: "Valider le ticket",
  },
  {
    notificationType: "WORKFLOW_PENDING",
    requestType: NOTIFICATION_REQUEST_TYPES.ASSET_REBUS,
    label: "Validation passage en rebus",
    emailSubjectTemplate: "Validation requise - passage en rebus {{asset_name}}",
    titleTemplate: "Validation requise - passage en rebus",
    bodyTemplate:
      "Une demande de passage en rebus attend votre décision pour {{asset_name}}. Motif: {{reason}}",
    ctaLabel: "Traiter la demande",
  },
  {
    notificationType: "WORKFLOW_APPROVED",
    requestType: NOTIFICATION_REQUEST_TYPES.ANY,
    label: "Demande approuvée",
    emailSubjectTemplate: "Demande approuvée - {{request_type_label}}",
    titleTemplate: "Demande approuvée - {{request_type_label}}",
    bodyTemplate:
      "Votre demande de {{request_type_label}} a été approuvée pour {{asset_name}}.",
    ctaLabel: "Ouvrir la demande",
  },
  {
    notificationType: "WORKFLOW_REJECTED",
    requestType: NOTIFICATION_REQUEST_TYPES.ANY,
    label: "Demande rejetée",
    emailSubjectTemplate: "Demande rejetée - {{request_type_label}}",
    titleTemplate: "Demande rejetée - {{request_type_label}}",
    bodyTemplate:
      "Votre demande de {{request_type_label}} a été rejetée pour {{asset_name}}. Note: {{resolution_note}}",
    ctaLabel: "Ouvrir la demande",
  },
  {
    notificationType: "WORKFLOW_FAILED",
    requestType: NOTIFICATION_REQUEST_TYPES.ANY,
    label: "Demande en échec",
    emailSubjectTemplate: "Demande en échec - {{request_type_label}}",
    titleTemplate: "Demande en échec - {{request_type_label}}",
    bodyTemplate:
      "Votre demande de {{request_type_label}} a rencontré un problème technique pour {{asset_name}}. Détail: {{resolution_note}}",
    ctaLabel: "Ouvrir la demande",
  },
  {
    notificationType: "INCIDENT_ALERT",
    requestType: NOTIFICATION_REQUEST_TYPES.ANY,
    label: "Alerte incident",
    emailSubjectTemplate: "Alerte incident - {{asset_name}}",
    titleTemplate: "Alerte incident - {{asset_name}}",
    bodyTemplate:
      "Un incident a été déclaré sur {{asset_name}}. Objet: {{incident_title}} | Statut: {{incident_status}}",
    ctaLabel: "Ouvrir l'actif",
  },
];

export const NOTIFICATION_TEMPLATE_PLACEHOLDERS = [
  "{{asset_name}}",
  "{{asset_code}}",
  "{{company_name}}",
  "{{request_type_label}}",
  "{{reason}}",
  "{{resolution_note}}",
  "{{title}}",
  "{{incident_title}}",
  "{{incident_status}}",
];

export const NOTIFICATION_CHANNEL_LABELS = {
  APP: "Application",
  EMAIL: "Email",
};

export const NOTIFICATION_ROUTING_ROLE_LABELS = {
  [APP_ROLES.CEO]: "CEO",
  [APP_ROLES.DAF]: "DAF",
  [APP_ROLES.RESPONSABLE]: "Responsable",
  [APP_ROLES.RESPONSABLE_MAINTENANCE]: "Resp. maintenance",
};

export function buildNotificationScenarioKey(notificationType, requestType = NOTIFICATION_REQUEST_TYPES.ANY) {
  return `${String(notificationType || "").toUpperCase()}::${String(requestType || NOTIFICATION_REQUEST_TYPES.ANY).toUpperCase()}`;
}

export function normalizeTemplateRows(rows = []) {
  const byKey = new Map(
    (rows || []).map((row) => [
      buildNotificationScenarioKey(row.notification_type, row.request_type),
      row,
    ])
  );

  return NOTIFICATION_TEMPLATE_SCENARIOS.map((scenario) => {
    const key = buildNotificationScenarioKey(scenario.notificationType, scenario.requestType);
    const row = byKey.get(key) || {};
    return {
      notification_type: scenario.notificationType,
      request_type: scenario.requestType,
      template_name: row.template_name || scenario.label,
      email_subject_template: row.email_subject_template || scenario.emailSubjectTemplate,
      title_template: row.title_template || scenario.titleTemplate,
      body_template: row.body_template || scenario.bodyTemplate,
      cta_label: row.cta_label || scenario.ctaLabel,
      is_enabled: row.is_enabled !== false,
      updated_at: row.updated_at || null,
    };
  });
}

export function normalizeRoutingRows(rows = []) {
  const byKey = new Map(
    (rows || []).map((row) => [
      buildNotificationScenarioKey(row.notification_type, row.request_type) +
        `::${String(row.channel || "").toUpperCase()}::${String(row.role || "").toUpperCase()}`,
      row,
    ])
  );

  return NOTIFICATION_ROUTING_SCENARIOS.map((scenario) => {
    const channels = {};
    Object.values(NOTIFICATION_CHANNELS).forEach((channel) => {
      channels[channel] = {};
      NOTIFICATION_ROUTING_ROLES.forEach((role) => {
        const key =
          buildNotificationScenarioKey(scenario.notificationType, scenario.requestType) +
          `::${channel}::${role}`;
        channels[channel][role] = byKey.get(key)?.is_enabled === true;
      });
    });

    return {
      notification_type: scenario.notificationType,
      request_type: scenario.requestType,
      title: scenario.title,
      description: scenario.description,
      allowedRoles: scenario.allowedRoles,
      channels,
    };
  });
}

export function isRoutingRoleAllowed(scenario, role) {
  return Array.isArray(scenario?.allowedRoles)
    ? scenario.allowedRoles.includes(role)
    : false;
}

export function buildTemplateUpsertRows(rows = [], updatedBy = null) {
  return (rows || []).map((row) => ({
    notification_type: row.notification_type,
    request_type: row.request_type,
    template_name: row.template_name,
    email_subject_template: row.email_subject_template,
    title_template: row.title_template,
    body_template: row.body_template,
    cta_label: row.cta_label,
    is_enabled: row.is_enabled !== false,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }));
}

export function buildRoutingUpsertRows(rows = [], updatedBy = null) {
  return (rows || []).flatMap((row) =>
    Object.values(NOTIFICATION_CHANNELS).flatMap((channel) =>
      NOTIFICATION_ROUTING_ROLES.map((role) => ({
        notification_type: row.notification_type,
        request_type: row.request_type,
        channel,
        role,
        is_enabled: isRoutingRoleAllowed(row, role)
          ? row?.channels?.[channel]?.[role] === true
          : false,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      }))
    )
  );
}
