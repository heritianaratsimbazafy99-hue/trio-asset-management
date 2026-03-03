import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import StatusBadge from "../../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import {
  APP_ROLES,
  getCurrentUserProfile,
  hasOneRole,
} from "../../lib/accessControl";
import {
  fetchUserDirectoryList,
  fetchUserDirectoryMapByIds,
  getUserLabelById,
} from "../../lib/userDirectory";

function formatEUR(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

function sanitizeSearchTerm(term) {
  return String(term || "")
    .trim()
    .replaceAll(",", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .trim();
}

function getUserOptionLabel(user) {
  return (
    user?.label ||
    user?.full_name ||
    user?.email ||
    user?.id ||
    ""
  );
}

function getMatchingAssignedUserIds(searchUsers, term) {
  if (!term) return [];
  const lowered = term.toLowerCase();
  return (searchUsers || [])
    .filter((user) => getUserOptionLabel(user).toLowerCase().includes(lowered))
    .map((user) => user.id)
    .filter(Boolean);
}

function buildAssetSearchOrClause(term, searchUsers, supportsAssignedToName) {
  if (!term) return "";

  const filters = [`name.ilike.%${term}%`];
  if (supportsAssignedToName) {
    filters.push(`assigned_to_name.ilike.%${term}%`);
  }

  const matchingUserIds = getMatchingAssignedUserIds(searchUsers, term);
  if (matchingUserIds.length > 0) {
    filters.push(`assigned_to_user_id.in.(${matchingUserIds.join(",")})`);
  }

  return filters.join(",");
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
  const [exporting, setExporting] = useState(false);
  const [assignedUsersMap, setAssignedUsersMap] = useState({});
  const [searchUsers, setSearchUsers] = useState([]);
  const [supportsAssignedToName, setSupportsAssignedToName] = useState(true);

  const canDeleteAssets = hasOneRole(userRole, [APP_ROLES.CEO]);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    fetchInitialContext();
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [
    selectedCompanyId,
    searchTerm,
    page,
    pageSize,
    sortBy,
    sortDirection,
    searchUsers,
    supportsAssignedToName,
  ]);

  async function fetchInitialContext() {
    const [{ data: orgs }, { profile }, users] = await Promise.all([
      supabase.from("organisations").select("id, name").order("name", { ascending: true }),
      getCurrentUserProfile(),
      fetchUserDirectoryList(),
    ]);
    setCompanies(orgs || []);
    setUserRole(profile?.role || "");
    setSearchUsers(users || []);

    const probe = await supabase.from("assets").select("assigned_to_name").limit(1);
    const columnMissing =
      probe?.error &&
      String(probe.error.message || "").toLowerCase().includes("assigned_to_name");
    setSupportsAssignedToName(!columnMissing);
  }

  async function fetchAssets() {
    setLoading(true);
    setError("");

    let query = supabase
      .from("assets")
      .select("*, organisations(name)", { count: "exact" })
      .order(sortBy, { ascending: sortDirection === "asc" });

    if (selectedCompanyId !== "ALL") {
      query = query.eq("company_id", selectedCompanyId);
    }
    const term = sanitizeSearchTerm(searchTerm);
    if (term) {
      const orClause = buildAssetSearchOrClause(term, searchUsers, supportsAssignedToName);
      query = query.or(orClause);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setAssets([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setAssets(data || []);
    setTotalCount(count || 0);
    const assignedIds = (data || []).map((item) => item.assigned_to_user_id).filter(Boolean);
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

    let query = supabase
      .from("assets")
      .select("*, organisations(name)")
      .order(sortBy, { ascending: sortDirection === "asc" });

    if (selectedCompanyId !== "ALL") {
      query = query.eq("company_id", selectedCompanyId);
    }
    const term = sanitizeSearchTerm(searchTerm);
    if (term) {
      const orClause = buildAssetSearchOrClause(term, searchUsers, supportsAssignedToName);
      query = query.or(orClause);
    }

    const { data, error: exportError } = await query;
    if (exportError) {
      setError(exportError.message);
      setExporting(false);
      return;
    }

    const headers = [
      "Nom",
      "Société",
      "Catégorie",
      "Valeur",
      "Statut",
      "Attribué à",
      "Date création",
    ];

    const assignedIds = (data || []).map((item) => item.assigned_to_user_id).filter(Boolean);
    const map = await fetchUserDirectoryMapByIds(assignedIds);
    const rows = (data || []).map((item) => [
      item.name,
      item.organisations?.name || "",
      item.category || "",
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

  function goToDetail(id) {
    router.push(`/assets/${id}`);
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
      `Supprimer définitivement l'actif "${asset.name}" ?`
    );
    if (!confirmed) return;

    setActionLoading(true);
    setError("");
    const { error: deleteError } = await supabase
      .from("assets")
      .delete()
      .eq("id", asset.id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
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

  const totals = useMemo(() => {
    return assets.reduce((sum, a) => sum + Number(a.purchase_value || a.value || 0), 0);
  }, [assets]);

  return (
    <Layout>
      <h1>Immobilisations</h1>

      <div className="card" style={{ marginBottom: 20 }}>
        <strong>Total valeur (page courante) :</strong> {formatEUR(totals)}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto auto", gap: 12 }}>
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
                      <span
                        onClick={() => goToDetail(asset.id)}
                        style={{ cursor: "pointer", color: "#1d3557", fontWeight: 600 }}
                      >
                        {asset.name}
                      </span>
                    </td>
                    <td>{asset.organisations?.name || "-"}</td>
                    <td>{asset.category || "-"}</td>
                    <td>{formatEUR(asset.purchase_value || asset.value)}</td>
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
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {assets.length === 0 && (
                  <tr>
                    <td colSpan={7}>Aucun actif correspondant.</td>
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
