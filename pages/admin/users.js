import { useEffect, useMemo, useState } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import {
  APP_ROLES,
  getCurrentUserProfile,
  hasOneRole,
} from "../../lib/accessControl";

const ROLE_OPTIONS = [
  APP_ROLES.CEO,
  APP_ROLES.DAF,
  APP_ROLES.RESPONSABLE,
  APP_ROLES.RESPONSABLE_MAINTENANCE,
];

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isCEO, setIsCEO] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [userDirectory, setUserDirectory] = useState([]);
  const [scoringRows, setScoringRows] = useState([]);

  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState(APP_ROLES.RESPONSABLE);
  const [newCompanyId, setNewCompanyId] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [companyFilter, setCompanyFilter] = useState("ALL");

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError("");
    setSuccess("");

    const [{ profile }, { data: orgs }, ceoProbe] = await Promise.all([
      getCurrentUserProfile(),
      supabase.from("organisations").select("id, name").order("name", { ascending: true }),
      supabase.rpc("is_ceo"),
    ]);

    const ceoFromProfile = hasOneRole(profile?.role, [APP_ROLES.CEO]);
    const ceoFromRpc = Boolean(ceoProbe?.data);
    const ceo = ceoFromProfile || ceoFromRpc;

    setIsCEO(ceo);
    setCompanies(orgs || []);
    setNewCompanyId(profile?.company_id || "");

    if (ceo) {
      await Promise.all([fetchProfiles(), fetchUserDirectory(), fetchScoringConfig()]);
    }

    setLoading(false);
  }

  async function fetchProfiles() {
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("id, role, company_id, organisations(name)")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
      return;
    }

    const normalized = (data || []).map((row) => ({
      ...row,
      role: String(row.role || APP_ROLES.RESPONSABLE).toUpperCase(),
      company_id: row.company_id || "",
    }));

    setProfiles(normalized);
  }

  async function fetchUserDirectory() {
    const { data, error: dirError } = await supabase
      .from("user_directory")
      .select("id, email")
      .order("email", { ascending: true });

    if (dirError) {
      setError(
        `Table user_directory indisponible: ${dirError.message}. Lance le script SQL de sécurité.`
      );
      return;
    }

    setUserDirectory(data || []);
  }

  async function fetchScoringConfig() {
    const { data, error: scoreError } = await supabase
      .from("company_scoring_config")
      .select("*")
      .order("company_id", { ascending: true });

    if (scoreError) {
      setError(`Config scoring indisponible: ${scoreError.message}`);
      return;
    }

    setScoringRows(data || []);
  }

  async function callAdminUpsertProfile(userId, role, companyId) {
    return supabase.rpc("admin_upsert_profile", {
      p_user_id: userId,
      p_role: role,
      p_company_id: companyId || null,
    });
  }

  async function updateProfile(profile) {
    setSaving(true);
    setError("");
    setSuccess("");

    const { error: rpcError } = await callAdminUpsertProfile(
      profile.id,
      profile.role,
      profile.company_id || null
    );

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setSuccess("Profil mis à jour.");
      await fetchProfiles();
    }

    setSaving(false);
  }

  async function createOrUpdateProfile() {
    setSaving(true);
    setError("");
    setSuccess("");

    const uid = newUserId.trim();
    if (!uid || !newCompanyId || !newRole) {
      setError("Utilisateur, rôle et société sont obligatoires.");
      setSaving(false);
      return;
    }

    const { error: rpcError } = await callAdminUpsertProfile(
      uid,
      newRole,
      newCompanyId
    );

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setSuccess("Profil créé/mis à jour.");
      setNewUserId("");
      await fetchProfiles();
    }

    setSaving(false);
  }

  async function updateScoringRow(row) {
    setSaving(true);
    setError("");
    setSuccess("");

    const payload = {
      company_id: row.company_id,
      weight_incidents: Number(row.weight_incidents || 0),
      weight_maintenance_ratio: Number(row.weight_maintenance_ratio || 0),
      weight_vnc_zero: Number(row.weight_vnc_zero || 0),
      incident_threshold: Number(row.incident_threshold || 1),
      replacement_ratio_threshold: Number(row.replacement_ratio_threshold || 0),
      replacement_vnc_threshold: Number(row.replacement_vnc_threshold || 0),
      top_risk_days: Number(row.top_risk_days || 30),
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("company_scoring_config")
      .upsert([payload], { onConflict: "company_id" });

    if (upsertError) {
      setError(upsertError.message);
    } else {
      setSuccess("Configuration scoring mise à jour.");
      await fetchScoringConfig();
    }

    setSaving(false);
  }

  const companyOptions = useMemo(() => companies || [], [companies]);
  const emailMap = useMemo(() => {
    const map = {};
    userDirectory.forEach((entry) => {
      if (entry.id) {
        map[entry.id] = entry.email || "";
      }
    });
    return map;
  }, [userDirectory]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((profile) => {
      const email = emailMap[profile.id] || "";
      const matchesSearch =
        !search.trim() ||
        profile.id.toLowerCase().includes(search.trim().toLowerCase()) ||
        email.toLowerCase().includes(search.trim().toLowerCase());
      const matchesRole = roleFilter === "ALL" || profile.role === roleFilter;
      const matchesCompany =
        companyFilter === "ALL" || profile.company_id === companyFilter;
      return matchesSearch && matchesRole && matchesCompany;
    });
  }, [profiles, search, roleFilter, companyFilter, emailMap]);

  if (loading) {
    return (
      <Layout>
        <p>Chargement...</p>
      </Layout>
    );
  }

  if (!isCEO) {
    return (
      <Layout>
        <h1>Administration</h1>
        <div className="alert-error">Accès réservé au CEO.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>Administration des utilisateurs</h1>
      <p style={{ marginBottom: 12 }}>
        Rôles, rattachement société et annuaire email.
      </p>

      {error && <div className="alert-error">{error}</div>}
      {success && <div className="alert-warning">{success}</div>}

      <div className="card">
        <h3>Créer / mettre à jour un profil</h3>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div className="form-field">
            <label>Utilisateur (email)</label>
            <select
              className="select"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
            >
              <option value="">Sélectionner un utilisateur</option>
              {userDirectory.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.email} ({entry.id})
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Rôle</label>
            <select
              className="select"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Société</label>
            <select
              className="select"
              value={newCompanyId}
              onChange={(e) => setNewCompanyId(e.target.value)}
            >
              <option value="">Sélectionner</option>
              {companyOptions.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn-primary" disabled={saving} onClick={createOrUpdateProfile}>
            {saving ? "Enregistrement..." : "Enregistrer le profil"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Filtres</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginTop: 10 }}>
          <input
            className="input"
            placeholder="Rechercher UID ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="ALL">Tous les rôles</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          >
            <option value="ALL">Toutes les sociétés</option>
            {companyOptions.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h3>Profils existants ({filteredProfiles.length})</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>UID</th>
              <th>Société</th>
              <th>Rôle</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.map((profile) => (
              <tr key={profile.id}>
                <td>{emailMap[profile.id] || "-"}</td>
                <td>{profile.id}</td>
                <td>
                  <select
                    className="select"
                    value={profile.company_id || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setProfiles((prev) =>
                        prev.map((item) =>
                          item.id === profile.id ? { ...item, company_id: value } : item
                        )
                      );
                    }}
                  >
                    <option value="">Sélectionner</option>
                    {companyOptions.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="select"
                    value={profile.role}
                    onChange={(e) => {
                      const value = e.target.value;
                      setProfiles((prev) =>
                        prev.map((item) =>
                          item.id === profile.id ? { ...item, role: value } : item
                        )
                      );
                    }}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn-secondary"
                    disabled={saving}
                    onClick={() => updateProfile(profile)}
                  >
                    Sauvegarder
                  </button>
                </td>
              </tr>
            ))}
            {filteredProfiles.length === 0 && (
              <tr>
                <td colSpan={5}>Aucun profil trouvé.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Scoring prédictif par société</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Société</th>
              <th>Poids incidents</th>
              <th>Poids ratio maintenance</th>
              <th>Poids VNC=0</th>
              <th>Seuil incidents</th>
              <th>Seuil ratio remplacement</th>
              <th>Seuil VNC remplacement</th>
              <th>Fenêtre risque (jours)</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {scoringRows.map((row) => (
              <tr key={row.company_id}>
                <td>{companies.find((c) => c.id === row.company_id)?.name || row.company_id}</td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.weight_incidents}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, weight_incidents: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.weight_maintenance_ratio}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, weight_maintenance_ratio: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.weight_vnc_zero}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, weight_vnc_zero: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.incident_threshold}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, incident_threshold: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.replacement_ratio_threshold}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, replacement_ratio_threshold: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.replacement_vnc_threshold}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, replacement_vnc_threshold: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    value={row.top_risk_days}
                    onChange={(e) =>
                      setScoringRows((prev) =>
                        prev.map((item) =>
                          item.company_id === row.company_id
                            ? { ...item, top_risk_days: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <button className="btn-secondary" disabled={saving} onClick={() => updateScoringRow(row)}>
                    Sauvegarder
                  </button>
                </td>
              </tr>
            ))}
            {scoringRows.length === 0 && (
              <tr>
                <td colSpan={9}>Aucune configuration trouvée.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
