import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Layout from "../../../components/Layout";
import supabase from "../../../lib/supabaseClient";
import { FIXED_ASSET_CATEGORIES } from "../../../lib/assetCategories";
import { ASSET_CONDITIONS } from "../../../lib/assetConditions";
import {
  APP_ROLES,
  getCurrentUserProfile,
  hasOneRole,
} from "../../../lib/accessControl";

export default function EditAsset() {
  const router = useRouter();
  const { id } = router.query;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [asset, setAsset] = useState(null);
  const [userRole, setUserRole] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "",
    current_condition: "BON",
    purchase_value: "",
    status: "EN_SERVICE",
    description: "",
  });

  const canEditPurchaseValue = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.DAF,
    APP_ROLES.RESPONSABLE,
  ]);

  useEffect(() => {
    if (!id) return;
    fetchAsset();
  }, [id]);

  const fetchAsset = async () => {
    setLoading(true);
    setError("");

    // 1. Vérifier utilisateur connecté + récupérer profil
    const { user, profile } = await getCurrentUserProfile();
    if (!user) {
      router.push("/login");
      return;
    }
    setUserRole(profile?.role || "");

    // 2. Charger l'actif (RLS protège la société)
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      setError("Actif introuvable ou accès refusé.");
      return;
    }

    setAsset(data);
    setForm({
      code: data.code || "",
      name: data.name || "",
      category: data.category || "",
      current_condition: data.current_condition || "BON",
      purchase_value: data.purchase_value ?? data.value ?? "",
      status: data.status || "EN_SERVICE",
      description: data.description || "",
    });

    setLoading(false);
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const normalizedPurchaseValue =
      form.purchase_value === "" ? null : Number(form.purchase_value);

    const updatePayload = {
      code: form.code,
      name: form.name,
      category: form.category,
      current_condition: form.current_condition || null,
      status: form.status,
      description: form.description,
    };

    if (canEditPurchaseValue) {
      updatePayload.purchase_value = Number.isFinite(normalizedPurchaseValue)
        ? normalizedPurchaseValue
        : null;
      // La valeur comptable historique suit la valeur d'achat dans l'app actuelle.
      updatePayload.value = updatePayload.purchase_value;
    }

    const { error } = await supabase
      .from("assets")
      .update(updatePayload)
      .eq("id", id);

    setSaving(false);

    if (error) {
      console.error(error);
      setError(`Erreur lors de la mise à jour: ${error.message}`);
    } else {
      router.push(`/assets/${id}`);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="form-card">
          <p>Chargement de l'actif...</p>
        </div>
      </Layout>
    );
  }

  if (!asset) {
    return (
      <Layout>
        <div className="page-header">
          <div>
            <h1>Éditer l’actif</h1>
            <p className="page-subtitle">Impossible de charger cet actif.</p>
          </div>
          <button className="btn-secondary" onClick={() => router.push("/assets")}>
            Retour aux immobilisations
          </button>
        </div>
        {error && <div className="alert-error">{error}</div>}
      </Layout>
    );
  }

  const hasLegacyCategory =
    form.category &&
    !FIXED_ASSET_CATEGORIES.some((item) => item.value === form.category);

  return (
    <Layout>
      <div className="breadcrumb">
        <Link href="/assets">Immobilisations</Link> /{" "}
        <Link href={`/assets/${asset.id}`}>{asset.name}</Link> / Modifier
      </div>

      <div className="page-header">
        <div>
          <h1>Éditer l’actif</h1>
          <p className="page-subtitle">
            Mise à jour des informations de <strong>{asset.name}</strong> ({asset.code || "Sans code"})
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={() => router.push(`/assets/${asset.id}`)}>
            Voir la fiche
          </button>
          <button className="btn-ghost" onClick={() => router.push("/assets")}>
            Retour liste
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-field">
              <label>Code</label>
              <input
                className="input"
                name="code"
                value={form.code}
                onChange={handleChange}
                placeholder="Code interne actif"
              />
            </div>

            <div className="form-field">
              <label>Nom *</label>
              <input
                className="input"
                name="name"
                required
                value={form.name}
                onChange={handleChange}
                placeholder="Nom de l'immobilisation"
              />
            </div>

            <div className="form-field">
              <label>Catégorie</label>
              <select
                className="select"
                name="category"
                value={form.category}
                onChange={handleChange}
              >
                <option value="">Sélectionner une catégorie</option>
                {hasLegacyCategory && (
                  <option value={form.category}>
                    Catégorie existante: {form.category}
                  </option>
                )}
                {FIXED_ASSET_CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Etat actuel</label>
              <select
                className="select"
                name="current_condition"
                value={form.current_condition}
                onChange={handleChange}
              >
                {ASSET_CONDITIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Valeur d'achat (Ar)</label>
              <input
                className="input"
                name="purchase_value"
                type="number"
                min="0"
                step="1"
                value={form.purchase_value}
                onChange={handleChange}
                disabled={!canEditPurchaseValue}
                placeholder="Ex: 1500000"
              />
              {!canEditPurchaseValue && (
                <small style={{ display: "block", marginTop: 6, color: "#5f6f83" }}>
                  Modification de la valeur d'achat réservée aux rôles CEO, DAF et RESPONSABLE.
                </small>
              )}
            </div>

            <div className="form-field">
              <label>Statut</label>
              <select
                className="select"
                name="status"
                value={form.status}
                onChange={handleChange}
              >
                <option value="EN_SERVICE">En service</option>
                <option value="EN_MAINTENANCE">En maintenance</option>
                <option value="HS">Hors service</option>
              </select>
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Description</label>
              <textarea
                className="textarea"
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Contexte, remarque technique, emplacement..."
              />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer les modifications"}
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => router.push(`/assets/${asset.id}`)}
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
