import { access, readFile, readdir } from "node:fs/promises";
import process from "node:process";

const REQUIRED_FILES = [
  "pages/_app.js",
  "pages/index.js",
  "pages/admin/users.js",
  "pages/approvals/index.js",
  "pages/audit-logs/index.js",
  "components/NotificationAlarm.js",
  "pages/assets/import.js",
  "pages/assets/[id]/journal.js",
  "lib/assetImport.js",
  "lib/dataHealth.js",
  "lib/emailNotifications.js",
  "lib/attachmentService.js",
  "lib/notifications.js",
  "lib/replacementPlanner.js",
  "lib/ruleEngine.js",
  "lib/supabaseAdmin.js",
  "lib/userDirectory.js",
  "lib/workflowRequests.js",
  "pages/api/notifications/email-dispatch.js",
  "pages/notifications/index.js",
  "pages/replacement-plan/index.js",
  "pages/rules/index.js",
  "docs/CONTEXT_REPRISE_2026-03-10.md",
  "docs/SQL_RUNBOOK_2026-03-10.md",
  "docs/SQL_CATALOG_2026-03-10.md",
  "sql/feature_email_notifications.sql",
  "sql/feature_notification_preferences.sql",
  "sql/sql_manifest_2026-03-10.json",
  "vercel.json",
];

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const EMAIL_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
  "CRON_SECRET",
];

const SQL_MANIFEST_PATH = "sql/sql_manifest_2026-03-10.json";
const SQL_RUNBOOK_PATH = "docs/SQL_RUNBOOK_2026-03-10.md";
const SQL_CATALOG_PATH = "docs/SQL_CATALOG_2026-03-10.md";

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

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function normalizeObjectArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

async function validateSqlConsolidation() {
  const errors = [];

  try {
    const manifestRaw = await readFile(SQL_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(manifestRaw);
    const runbookRaw = await readFile(SQL_RUNBOOK_PATH, "utf8");
    const catalogRaw = await readFile(SQL_CATALOG_PATH, "utf8");

    const canonical = normalizeStringArray(manifest?.catalog?.canonical);
    const fromScratch = normalizeStringArray(manifest?.runbooks?.fromScratch);
    const superseded = normalizeObjectArray(manifest?.catalog?.superseded);
    const targetedPatches = normalizeObjectArray(manifest?.catalog?.targetedPatches);
    const prodCatchUp = manifest?.runbooks?.prodCatchUp || {};

    if (canonical.length === 0) {
      errors.push("Manifest SQL: catalog.canonical est vide.");
    }

    if (JSON.stringify(canonical) !== JSON.stringify(fromScratch)) {
      errors.push(
        "Manifest SQL: runbooks.fromScratch doit correspondre exactement à catalog.canonical."
      );
    }

    const sqlFilesOnDisk = (await readdir("sql"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => `sql/${file}`)
      .sort();

    const catalogFiles = new Set(canonical);
    for (const item of superseded) {
      if (typeof item.file === "string" && item.file.trim()) {
        catalogFiles.add(item.file.trim());
      }
      for (const replacement of normalizeStringArray(item.replacedBy)) {
        catalogFiles.add(replacement);
      }
    }
    for (const item of targetedPatches) {
      if (typeof item.file === "string" && item.file.trim()) {
        catalogFiles.add(item.file.trim());
      }
    }

    const missingFromCatalog = sqlFilesOnDisk.filter((file) => !catalogFiles.has(file));
    const unknownInCatalog = Array.from(catalogFiles).filter(
      (file) => !sqlFilesOnDisk.includes(file)
    );

    if (missingFromCatalog.length > 0) {
      errors.push(`Manifest SQL: scripts non classes -> ${missingFromCatalog.join(", ")}`);
    }
    if (unknownInCatalog.length > 0) {
      errors.push(`Manifest SQL: references inconnues -> ${unknownInCatalog.join(", ")}`);
    }

    const orderIndex = new Map(fromScratch.map((file, index) => [file, index]));
    const dependencyPairs = [
      [
        "sql/feature_audit_assignment_history.sql",
        "sql/assignment_update_ceo_daf_and_history_names.sql",
      ],
      ["sql/feature_app_notifications.sql", "sql/feature_email_notifications.sql"],
      ["sql/feature_email_notifications.sql", "sql/feature_notification_preferences.sql"],
      ["sql/assignment_update_ceo_daf_and_history_names.sql", "sql/feature_asset_bulk_import.sql"],
      [
        "sql/hotfix_asset_current_condition.sql",
        "sql/hotfix_2026_03_04_assets_search_and_user_labels.sql",
      ],
      ["sql/hotfix_asset_current_condition.sql", "sql/feature_asset_bulk_import.sql"],
      ["sql/hotfix_asset_vehicle_details.sql", "sql/feature_asset_bulk_import.sql"],
      ["sql/hotfix_asset_code_autogenerate.sql", "sql/feature_asset_bulk_import.sql"],
    ];

    for (const [beforeFile, afterFile] of dependencyPairs) {
      const beforeIndex = orderIndex.get(beforeFile);
      const afterIndex = orderIndex.get(afterFile);
      if (beforeIndex == null || afterIndex == null || beforeIndex >= afterIndex) {
        errors.push(`Manifest SQL: ordre invalide, ${beforeFile} doit preceder ${afterFile}.`);
      }
    }

    const runbookRefs = new Set([
      SQL_MANIFEST_PATH,
      SQL_CATALOG_PATH,
      ...fromScratch,
      ...Object.values(prodCatchUp).flatMap((value) => normalizeStringArray(value)),
    ]);
    for (const ref of runbookRefs) {
      if (!runbookRaw.includes(ref)) {
        errors.push(`Runbook SQL: reference manquante -> ${ref}`);
      }
    }

    const catalogRefs = new Set([SQL_MANIFEST_PATH, SQL_RUNBOOK_PATH, ...sqlFilesOnDisk]);
    for (const ref of catalogRefs) {
      if (!catalogRaw.includes(ref)) {
        errors.push(`Catalogue SQL: reference manquante -> ${ref}`);
      }
    }
  } catch (error) {
    errors.push(`Consolidation SQL: ${(error && error.message) || error}`);
  }

  return errors;
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

  printSection("SQL CONSOLIDATION");
  const sqlErrors = await validateSqlConsolidation();
  if (sqlErrors.length === 0) {
    console.log("OK manifeste, runbook et catalogue SQL alignes");
  } else {
    for (const error of sqlErrors) {
      console.log(`ERROR ${error}`);
    }
    hasError = true;
  }

  printSection("ENV");
  for (const key of REQUIRED_ENV_KEYS) {
    const ok = Boolean(process.env[key]);
    console.log(`${ok ? "OK" : "MISSING"} ${key}`);
    if (!ok) hasError = true;
  }

  printSection("EMAIL ENV");
  for (const key of EMAIL_ENV_KEYS) {
    const ok = Boolean(process.env[key]);
    console.log(`${ok ? "OK" : "WARN"} ${key}`);
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
