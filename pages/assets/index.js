import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import StatusBadge from "../../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { getCurrentUserProfile } from "../../lib/accessControl";
import {
  fetchUserDirectoryMapByIds,
  getUserLabelById,
} from "../../lib/userDirectory";
import { formatMGA } from "../../lib/currency";
import {
  FIXED_ASSET_CATEGORIES,
  getAssetCategoryLabel,
} from "../../lib/assetCategories";
import {
  ASSET_CONDITIONS,
  getAssetConditionLabel,
} from "../../lib/assetConditions";
import {
  canDirectlyDeleteAsset,
  canRequestAssetDeletion,
} from "../../lib/workflowRequests";

function normalizeSearchTerm(term) {
  return String(term || "").trim();
}

function isMissingRpcSignatureError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("search_assets_secure") &&
    (message.includes("does not exist") || message.includes("could not find the function"))
  );
}

async function runSearchAssetsRpc(params) {
  let response = await supabase.rpc("search_assets_secure", params);
  if (!response.error || !isMissingRpcSignatureError(response.error)) return response;

  const { p_condition, ...withoutCondition } = params;
  response = await supabase.rpc("search_assets_secure", withoutCondition);
  if (!response.error || !isMissingRpcSignatureError(response.error)) return response;

  const { p_category, ...legacyWithoutCategory } = withoutCondition;
  return supabase.rpc("search_assets_secure", legacyWithoutCategory);
}

function getAssignedDisplayLabel(asset, assignedUsersMap) {
  const fromUser = asset?.assigned_to_user_id
    ? getUserLabelById(assignedUsersMap, asset.assigned_to_user_id)
    : "";
  if (fromUser && fromUser !== asset?.assigned_to_user_id) return fromUser;
  if (asset?.assigned_to_name) return asset.assigned_to_name;
  if (fromUser) return fromUser;
  return "-";
}

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const SORT_OPTIONS = [
  { value: "name", label: "Nom" },
  { value: "purchase_value", label: "Valeur" },
  { value: "created_at", label: "Date création" },
];

export default function AssetsPage() {
  const router = useRouter();
  const [assets, setAssets] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedCondition, setSelectedCondition] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [assignedUsersMap, setAssignedUsersMap] = useState({});

  const canDeleteAssets = canRequestAssetDeletion(userRole);
  const canDeleteDirectly = canDirectlyDeleteAsset(userRole);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    fetchInitialContext();
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [
    selectedCompanyId,
    selectedCategory,
    selectedCondition,
    searchTerm,
    page,
    pageSize,
    sortBy,
    sortDirection,
  ]);

  async function fetchInitialContext() {
    const [{ data: orgs }, { profile }] = await Promise.all([
      supabase.from("organisations").select("id, name").order("name", { ascending: true }),
      getCurrentUserProfile(),
    ]);
    setCompanies(orgs || []);
    setUserRole(profile?.role || "");
  }

  async function fetchAssets() {
    setLoading(true);
    setError("");

    const from = (page - 1) * pageSize;
    const term = normalizeSearchTerm(searchTerm);
    const params = {
      p_company_id: selectedCompanyId === "ALL" ? null : selectedCompanyId,
      p_search: term || null,
      p_category: selectedCategory === "ALL" ? null : selectedCategory,
      p_condition: selectedCondition === "ALL" ? null : selectedCondition,
      p_limit: pageSize,
      p_offset: from,
      p_sort_by: sortBy,
      p_sort_direction: sortDirection,
    };
    const queryResponse = await runSearchAssetsRpc(params);
    const data = queryResponse.data;
    const queryError = queryResponse.error;

    if (queryError) {
      setError(queryError.message);
      setAssets([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const rows = (data || []).map((item) => ({
      ...item,
      organisations: { name: item.organisation_name || "" },
    }));
    setAssets(rows);
    setTotalCount(rows.length ? Number(rows[0].total_count || 0) : 0);
    const assignedIds = rows.map((item) => item.assigned_to_user_id).filter(Boolean);
    const map = await fetchUserDirectoryMapByIds(assignedIds);
    setAssignedUsersMap(map);
    setLoading(false);
  }

  function sanitizeCsvCell(value) {
    const raw = String(value ?? "");
    if (raw.includes('"') || raw.includes(";") || raw.includes("\n")) {
      return `"${raw.replaceAll('"', '""')}"`;
    }
    return raw;
  }

  async function exportCsv() {
    setExporting(true);
    setError("");

    const term = normalizeSearchTerm(searchTerm);
    const batchSize = 500;
    let offset = 0;
    let allRows = [];

    while (true) {
      const params = {
        p_company_id: selectedCompanyId === "ALL" ? null : selectedCompanyId,
        p_search: term || null,
        p_category: selectedCategory === "ALL" ? null : selectedCategory,
        p_condition: selectedCondition === "ALL" ? null : selectedCondition,
        p_limit: batchSize,
        p_offset: offset,
        p_sort_by: sortBy,
        p_sort_direction: sortDirection,
      };

      const batchResponse = await runSearchAssetsRpc(params);
      const data = batchResponse.data;
      const batchError = batchResponse.error;

      if (batchError) {
        setError(batchError.message);
        setExporting(false);
        return;
      }

      const rows = (data || []).map((item) => ({
        ...item,
        organisations: { name: item.organisation_name || "" },
      }));
      allRows = allRows.concat(rows);

      if (rows.length < batchSize) break;
      offset += batchSize;

      if (offset >= 10000) break;
    }

    const headers = [
      "Nom",
      "Société",
      "Catégorie",
      "Etat actuel",
      "Valeur",
      "Statut",
      "Attribué à",
      "Date création",
    ];

    const assignedIds = allRows.map((item) => item.assigned_to_user_id).filter(Boolean);
    const map = await fetchUserDirectoryMapByIds(assignedIds);
    const rows = allRows.map((item) => [
      item.name,
      item.organisations?.name || "",
      getAssetCategoryLabel(item.category),
      getAssetConditionLabel(item.current_condition),
      Number(item.purchase_value ?? item.value ?? 0).toFixed(2),
      item.status || "",
      getAssignedDisplayLabel(item, map),
      item.created_at ? new Date(item.created_at).toISOString() : "",
    ]);

    const csv = [headers, ...rows]
      .map((line) => line.map(sanitizeCsvCell).join(";"))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `assets_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  function handleIncident(id) {
    router.push(`/incidents/new?asset_id=${id}`);
  }

  function handleMaintenance(id) {
    router.push(`/maintenance/new?asset_id=${id}`);
  }

  async function handleDeleteAsset(asset) {
    if (!canDeleteAssets) return;
    const confirmed = window.confirm(
      canDeleteDirectly
        ? `Supprimer immédiatement l'actif "${asset.name}" ?`
        : `Créer une demande de suppression pour l'actif "${asset.name}" ?`
    );
    if (!confirmed) return;

    setActionLoading(true);
    setError("");
    setMessage("");

    let deleteError = null;

    if (canDeleteDirectly) {
      const reason = window.prompt(
        "Motif de suppression (optionnel, recommandé pour traçabilité)",
        ""
      );
      if (reason === null) {
        setActionLoading(false);
        return;
      }

      const response = await supabase.rpc("delete_asset_immediately", {
        p_asset_id: asset.id,
        p_reason: reason.trim() || null,
      });
      deleteError = response.error;
    } else {
      const reason = window.prompt("Motif de suppression (obligatoire)", "");
      if (reason === null) {
        setActionLoading(false);
        return;
      }
      if (!reason.trim()) {
        setActionLoading(false);
        setError("Le motif de suppression est obligatoire.");
        return;
      }

      const response = await supabase.rpc("request_asset_delete", {
        p_asset_id: asset.id,
        p_reason: reason.trim(),
      });
      deleteError = response.error;
    }

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage(
        canDeleteDirectly
          ? "Actif supprimé par le CEO."
          : "Demande de suppression créée. Elle est maintenant en attente de validation du CEO."
      );
      await fetchAssets();
    }
    setActionLoading(false);
  }

  function handleSearchChange(value) {
    setSearchTerm(value);
    setPage(1);
  }

  function handleCompanyFilterChange(value) {
    setSelectedCompanyId(value);
    setPage(1);
  }

  function handleCategoryFilterChange(value) {
    setSelectedCategory(value);
    setPage(1);
  }

  function handleConditionFilterChange(value) {
    setSelectedCondition(value);
    setPage(1);
  }

  const totals = useMemo(() => {
    return assets.reduce((sum, a) => sum + Number(a.purchase_value || a.value || 0), 0);
  }, [assets]);

  return (
    <Layout>
      <h1>Immobilisations</h1>
      {message && <div className="alert-success">{message}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <strong>Total valeur (page courante) :</strong> {formatMGA(totals)}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr auto auto",
            gap: 12,
          }}
        >
          <input
            className="input"
            placeholder="Rechercher par actif ou personne attribuée..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
          />

          <select
            className="select"
            value={selectedCompanyId}
            onChange={(e) => handleCompanyFilterChange(e.target.value)}
          >
            <option value="ALL">Toutes les sociétés</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={selectedCategory}
            onChange={(e) => handleCategoryFilterChange(e.target.value)}
          >
            <option value="ALL">Toutes les catégories</option>
            {FIXED_ASSET_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={selectedCondition}
            onChange={(e) => handleConditionFilterChange(e.target.value)}
          >
            <option value="ALL">Tous les états</option>
            {ASSET_CONDITIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>

          <select
            className="select"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              setPage(1);
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Tri: {option.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={sortDirection}
            onChange={(e) => {
              setSortDirection(e.target.value);
              setPage(1);
            }}
          >
            <option value="desc">Ordre: Desc</option>
            <option value="asc">Ordre: Asc</option>
          </select>

          <button className="btn-secondary" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Export..." : "Exporter CSV"}
          </button>

          <button className="btn-warning" onClick={() => router.push("/assets/import")}>
            Import massif
          </button>

          <button className="btn-primary" onClick={() => router.push("/assets/new")}>
            + Ajouter un actif
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Société</th>
                  <th>Catégorie</th>
                  <th>Etat actuel</th>
                  <th>Valeur</th>
                  <th>Statut</th>
                  <th>Attribué à</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <Link className="dashboard-link" href={`/assets/${asset.id}`}>
                        {asset.name}
                      </Link>
                    </td>
                    <td>{asset.organisations?.name || "-"}</td>
                    <td>{getAssetCategoryLabel(asset.category)}</td>
                    <td>{getAssetConditionLabel(asset.current_condition)}</td>
                    <td>{formatMGA(asset.purchase_value || asset.value)}</td>
                    <td><StatusBadge status={asset.status} /></td>
                    <td>{getAssignedDisplayLabel(asset, assignedUsersMap)}</td>
                    <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn-primary" onClick={() => handleIncident(asset.id)}>
                        Incident
                      </button>
                      <button className="btn-warning" onClick={() => handleMaintenance(asset.id)}>
                        Maintenance
                      </button>
                      {canDeleteAssets && (
                        <button
                          className="btn-secondary"
                          disabled={actionLoading}
                          onClick={() => handleDeleteAsset(asset)}
                        >
                          {canDeleteDirectly ? "Supprimer actif" : "Demander suppression"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {assets.length === 0 && (
                  <tr>
                    <td colSpan={8}>Aucun actif correspondant.</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              <span>
                Page {page} / {totalPages} - {totalCount} actifs
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Precedent
                </button>
                <button
                  className="btn-secondary"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Suivant
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
