import { APP_ROLES, hasOneRole } from "./accessControl";

export const DATA_HEALTH_ISSUES = [
  {
    qualityKey: "missing_value",
    issueType: "MISSING_VALUE",
    label: "Actifs sans valeur",
    description: "Actifs dont la valeur d'achat n'est pas renseignée.",
  },
  {
    qualityKey: "missing_company",
    issueType: "MISSING_COMPANY",
    label: "Actifs sans société",
    description: "Actifs sans rattachement société.",
  },
  {
    qualityKey: "missing_amortization",
    issueType: "MISSING_AMORTIZATION",
    label: "Amortissement incomplet",
    description: "Actifs avec type ou durée d'amortissement manquants.",
  },
  {
    qualityKey: "maintenance_missing_deadline",
    issueType: "MAINTENANCE_MISSING_DEADLINE",
    label: "Maintenance sans deadline",
    description: "Tickets maintenance sans date limite.",
  },
  {
    qualityKey: "incidents_missing_title",
    issueType: "INCIDENT_MISSING_TITLE",
    label: "Incidents sans titre",
    description: "Incidents dont le titre est vide.",
  },
];

export function getDataHealthIssueConfig(issueType) {
  return DATA_HEALTH_ISSUES.find((item) => item.issueType === issueType) || null;
}

export function canFixDataHealthIssue(userRole, issueType) {
  const leadershipRoles = [APP_ROLES.CEO, APP_ROLES.DAF, APP_ROLES.RESPONSABLE];
  const opsRoles = [...leadershipRoles, APP_ROLES.RESPONSABLE_MAINTENANCE];

  if (issueType === "MISSING_VALUE") {
    return hasOneRole(userRole, [APP_ROLES.CEO]);
  }

  if (issueType === "MISSING_COMPANY" || issueType === "MISSING_AMORTIZATION") {
    return hasOneRole(userRole, leadershipRoles);
  }

  if (
    issueType === "MAINTENANCE_MISSING_DEADLINE" ||
    issueType === "INCIDENT_MISSING_TITLE"
  ) {
    return hasOneRole(userRole, opsRoles);
  }

  return false;
}
