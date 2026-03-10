import { access, readFile } from "node:fs/promises";
import process from "node:process";

const REQUIRED_FILES = [
  "pages/_app.js",
  "pages/index.js",
  "pages/admin/users.js",
  "pages/approvals/index.js",
  "pages/audit-logs/index.js",
  "pages/assets/[id]/journal.js",
  "lib/attachmentService.js",
  "lib/replacementPlanner.js",
  "lib/ruleEngine.js",
  "lib/userDirectory.js",
  "lib/workflowRequests.js",
  "pages/replacement-plan/index.js",
  "pages/rules/index.js",
  "sql/group_mode_roles_setup.sql",
  "sql/security_admin_audit_upgrade.sql",
  "sql/feature_audit_assignment_history.sql",
  "sql/feature_workflow_approvals.sql",
  "sql/feature_maintenance_rebus_workflows.sql",
  "sql/feature_lot3_workflow_roles_and_asset_history.sql",
  "sql/feature_replacement_plan_simulation.sql",
  "sql/feature_company_rules_engine.sql",
  "sql/predeploy_hardening.sql",
  "sql/step_1_security_integrity_hardening.sql",
  "sql/step_2_secure_search_and_dashboard_rpc.sql",
  "sql/step_3_post_migration_checks.sql",
  "sql/step_4_user_labels_email_patch.sql",
];

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadLocalEnv() {
  const envPath = ".env.local";
  if (!(await exists(envPath))) return;

  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function printSection(title) {
  console.log(`\n[${title}]`);
}

async function run() {
  let hasError = false;
  await loadLocalEnv();

  printSection("FILES");
  for (const file of REQUIRED_FILES) {
    const ok = await exists(file);
    console.log(`${ok ? "OK" : "MISSING"} ${file}`);
    if (!ok) hasError = true;
  }

  printSection("ENV");
  for (const key of REQUIRED_ENV_KEYS) {
    const ok = Boolean(process.env[key]);
    console.log(`${ok ? "OK" : "MISSING"} ${key}`);
    if (!ok) hasError = true;
  }

  printSection("RESULT");
  if (hasError) {
    console.error("Predeploy check failed.");
    process.exit(1);
  }
  console.log("Predeploy check passed.");
}

run().catch((error) => {
  console.error("Predeploy check crashed:", error?.message || error);
  process.exit(1);
});
