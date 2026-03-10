import { useMemo, useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import {
  ASSET_IMPORT_TEMPLATE_COLUMNS,
  downloadAssetImportTemplate,
  parseAssetImportFile,
} from "../../lib/assetImport";

function getImportStatusClassName(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "IMPORTED") return "badge-success";
  if (normalized === "READY") return "badge-warning";
  return "badge-danger";
}

function getImportStatusLabel(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "IMPORTED") return "Importé";
  if (normalized === "READY") return "Prêt";
  if (normalized === "ERROR") return "Erreur";
  return normalized || "-";
}

function normalizeMessages(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return [];
}

export default function AssetImportPage() {
  const router = useRouter();

  const [userRole, setUserRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);

  const canImportAssets = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.DAF,
    APP_ROLES.RESPONSABLE,
  ]);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    const { profile } = await getCurrentUserProfile();
    setUserRole(profile?.role || "");
    setLoading(false);
  }

  const previewSummary = useMemo(() => {
    return previewRows.reduce(
      (acc, row) => {
        const status = String(row.status || "").toUpperCase();
        if (status === "READY") acc.ready += 1;
        if (status === "ERROR") acc.error += 1;
        if (status === "IMPORTED") acc.imported += 1;
        return acc;
      },
      { ready: 0, error: 0, imported: 0 }
    );
  }, [previewRows]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const rows = await parseAssetImportFile(file);
      setParsedRows(rows);
      setPreviewRows([]);
      setFileName(file.name);
      setMessage(`${rows.length} ligne(s) détectée(s). Lance maintenant le dry-run.`);
    } catch (parseError) {
      setParsedRows([]);
      setPreviewRows([]);
      setFileName("");
      setError(parseError.message || "Fichier d'import invalide.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function runDryRun() {
    if (!parsedRows.length) {
      setError("Charge d'abord un fichier d'import.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    const { data, error: rpcError } = await supabase.rpc("bulk_import_assets", {
      p_rows: parsedRows,
      p_dry_run: true,
    });

    if (rpcError) {
      setError(rpcError.message);
      setPreviewRows([]);
      setBusy(false);
      return;
    }

    const rows = data || [];
    setPreviewRows(rows);
    setMessage(
      `${rows.length} ligne(s) analysée(s) - ${rows.filter((row) => row.status === "READY").length} prête(s), ${rows.filter((row) => row.status === "ERROR").length} en erreur.`
    );
    setBusy(false);
  }

  async function runImport() {
    if (!parsedRows.length) {
      setError("Charge d'abord un fichier d'import.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    const { data, error: rpcError } = await supabase.rpc("bulk_import_assets", {
      p_rows: parsedRows,
      p_dry_run: false,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    const rows = data || [];
    setPreviewRows(rows);
    const importedCount = rows.filter((row) => String(row.status || "").toUpperCase() === "IMPORTED").length;
    const errorCount = rows.filter((row) => String(row.status || "").toUpperCase() === "ERROR").length;
    setMessage(`${importedCount} actif(s) importé(s). ${errorCount} ligne(s) restent en erreur.`);
    setBusy(false);
  }

  if (loading) {
    return (
      <Layout>
        <h1>Import massif d'actifs</h1>
        <p>Chargement...</p>
      </Layout>
    );
  }

  if (!canImportAssets) {
    return (
      <Layout>
        <h1>Import massif d'actifs</h1>
        <div className="alert-error">
          Accès réservé aux rôles CEO, DAF et RESPONSABLE.
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="dashboard-header-row">
        <div>
          <h1>Import massif d'actifs</h1>
          <p className="page-subtitle">
            Charge un fichier Excel ou CSV, lance un dry-run de validation, puis importe uniquement les lignes valides.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={() => router.push("/assets")}>
            Retour aux actifs
          </button>
          <button className="btn-primary" onClick={() => downloadAssetImportTemplate()}>
            Télécharger le modèle
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <strong>Colonnes attendues:</strong> {ASSET_IMPORT_TEMPLATE_COLUMNS.join(", ")}
          </div>
          <div>
            <strong>Formats acceptés:</strong> `.csv`, `.xlsx`, `.xls`
          </div>
          <div>
            <strong>Lot maximal:</strong> 1000 lignes par import
          </div>
          <input
            className="input"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            disabled={busy}
          />
          {fileName && <div>Fichier chargé: {fileName}</div>}
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-secondary" disabled={busy || !parsedRows.length} onClick={runDryRun}>
            {busy ? "Analyse..." : "Lancer le dry-run"}
          </button>
          <button
            className="btn-warning"
            disabled={busy || !parsedRows.length}
            onClick={runImport}
          >
            {busy ? "Import..." : "Importer les lignes valides"}
          </button>
        </div>
      </div>

      {!!previewRows.length && (
        <div className="dashboard-grid" style={{ marginBottom: 16 }}>
          <div className="card">
            <h3>Lignes prêtes</h3>
            <p>{previewSummary.ready}</p>
          </div>
          <div className="card">
            <h3>Lignes en erreur</h3>
            <p>{previewSummary.error}</p>
          </div>
          <div className="card">
            <h3>Lignes importées</h3>
            <p>{previewSummary.imported}</p>
          </div>
        </div>
      )}

      <div className="card">
        {!previewRows.length ? (
          <p>Aucun résultat pour le moment. Charge un fichier puis lance le dry-run.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Nom</th>
                  <th>Société</th>
                  <th>Statut</th>
                  <th>Code actif</th>
                  <th>Erreurs</th>
                  <th>Avertissements</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const errors = normalizeMessages(row.errors);
                  const warnings = normalizeMessages(row.warnings);

                  return (
                    <tr key={`${row.row_number}-${row.source_name || "row"}`}>
                      <td>{row.row_number}</td>
                      <td>{row.source_name || row.normalized_payload?.name || "-"}</td>
                      <td>{row.company_name || row.normalized_payload?.company_name || "-"}</td>
                      <td>
                        <span className={getImportStatusClassName(row.status)}>
                          {getImportStatusLabel(row.status)}
                        </span>
                      </td>
                      <td>{row.asset_code || "-"}</td>
                      <td>
                        {errors.length ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            {errors.map((item, index) => (
                              <span key={`${row.row_number}-error-${index}`}>{item}</span>
                            ))}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        {warnings.length ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            {warnings.map((item, index) => (
                              <span key={`${row.row_number}-warning-${index}`}>{item}</span>
                            ))}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
