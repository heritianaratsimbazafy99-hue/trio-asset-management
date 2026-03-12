import { supabase } from "./supabaseClient";

export const APP_ROLES = {
  CEO: "CEO",
  DAF: "DAF",
  RESPONSABLE: "RESPONSABLE",
  RESPONSABLE_MAINTENANCE: "RESPONSABLE_MAINTENANCE",
};

export const OPERATIONAL_LEADERSHIP_ROLES = [
  APP_ROLES.CEO,
  APP_ROLES.DAF,
  APP_ROLES.RESPONSABLE_MAINTENANCE,
];

export const WORKFLOW_APPROVER_ROLES = [
  APP_ROLES.CEO,
  APP_ROLES.DAF,
  APP_ROLES.RESPONSABLE,
];

export function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase();
}

export function hasOneRole(profileRole, allowedRoles = []) {
  const normalized = normalizeRole(profileRole);
  return allowedRoles.some((item) => normalizeRole(item) === normalized);
}

export function canApproveWorkflow(profileRole) {
  return hasOneRole(profileRole, WORKFLOW_APPROVER_ROLES);
}

export async function getCurrentUserProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, company_id")
    .eq("id", user.id)
    .single();

  return { user, profile: profile || null };
}
