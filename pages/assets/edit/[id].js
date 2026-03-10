import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Layout from "../../../components/Layout";
import supabase from "../../../lib/supabaseClient";
import { FIXED_ASSET_CATEGORIES } from "../../../lib/assetCategories";
import { ASSET_CONDITIONS } from "../../../lib/assetConditions";
import {
  computeInsuranceStatusByDates,
  DEFAULT_VEHICLE_INFO,
  INSURANCE_TYPE_OPTIONS,
  VEHICLE_STATUS_OPTIONS,
  isVehicleCategory,
  insuranceStatusLabel,
  normalizeVehicleInfo,
} from "../../../lib/vehicleInfo";
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
  const [warning, setWarning] = useState("");

  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "",
    current_condition: "BON",
    purchase_value: "",
    status: "EN_SERVICE",
    description: "",
  });
  const [vehicleInfo, setVehicleInfo] = useState(DEFAULT_VEHICLE_INFO);

  const canEditPurchaseValue = hasOneRole(userRole, [
    APP_ROLES.CEO,
    APP_ROLES.DAF,
    APP_ROLES.RESPONSABLE,
  ]);
  const isVehicleAsset = isVehicleCategory(form.category);

  useEffect(() => {
    if (!id) return;
    fetchAsset();
  }, [id]);

  useEffect(() => {
    if (!isVehicleAsset) return;

    const nextStatus = computeInsuranceStatusByDates(
      vehicleInfo.insurance_start_date,
      vehicleInfo.insurance_end_date
    );

    setVehicleInfo((prev) => {
      if ((prev.insurance_status || "INACTIVE") === nextStatus) return prev;
      return { ...prev, insurance_status: nextStatus };
    });
  }, [isVehicleAsset, vehicleInfo.insurance_start_date, vehicleInfo.insurance_end_date]);

  const fetchAsset = async () => {
    setLoading(true);
    setError("");
    setWarning("");

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
      setLoading(false);
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

    const rawVehicleInfo =
      data.vehicle_details && typeof data.vehicle_details === "object"
        ? data.vehicle_details
        : {};

    const mergedVehicleInfo = {
      ...DEFAULT_VEHICLE_INFO,
      ...rawVehicleInfo,
    };

    mergedVehicleInfo.insurance_status = computeInsuranceStatusByDates(
      mergedVehicleInfo.insurance_start_date,
      mergedVehicleInfo.insurance_end_date
    );

    setVehicleInfo(mergedVehicleInfo);

    setLoading(false);
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleVehicleInfoChange = (field, value) => {
    setVehicleInfo((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setWarning("");

    const normalizedPurchaseValue =
      form.purchase_value === "" ? null : Number(form.purchase_value);
    const normalizedVehicleDetails = isVehicleAsset
      ? normalizeVehicleInfo({
          ...vehicleInfo,
          insurance_status: computeInsuranceStatusByDates(
            vehicleInfo.insurance_start_date,
            vehicleInfo.insurance_end_date
          ),
        })
      : null;

    const updatePayload = {
      code: form.code,
      name: form.name,
      category: form.category,
      current_condition: form.current_condition || null,
      status: form.status,
      description: form.description,
    };

    if (isVehicleAsset) {
      updatePayload.vehicle_details = normalizedVehicleDetails;
    }

    if (canEditPurchaseValue) {
      updatePayload.purchase_value = Number.isFinite(normalizedPurchaseValue)
        ? normalizedPurchaseValue
        : null;
      // La valeur comptable historique suit la valeur d'achat dans l'app actuelle.
      updatePayload.value = updatePayload.purchase_value;
    }

    let finalPayload = { ...updatePayload };
    let { error } = await supabase
      .from("assets")
      .update(finalPayload)
      .eq("id", id);

    if (
      error &&
      String(error.message || "").toLowerCase().includes("vehicle_details") &&
      Object.prototype.hasOwnProperty.call(finalPayload, "vehicle_details")
    ) {
      delete finalPayload.vehicle_details;
      const fallbackResponse = await supabase
        .from("assets")
        .update(finalPayload)
        .eq("id", id);
      error = fallbackResponse.error;
      if (!fallbackResponse.error) {
        setWarning(
          "Modifications enregistrées sans les informations véhicule. Exécute la migration SQL vehicle_details."
        );
      }
    }

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
      {warning && <div className="alert-warning">{warning}</div>}

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

            {isVehicleAsset && (
              <div className="vehicle-extra-section">
                <h3>Informations véhicule</h3>
                <p>
                  Bloc affiché uniquement pour les catégories Vehicule - Moto et Vehicule - Voiture.
                </p>

                <div className="vehicle-extra-grid">
                  <div className="form-field">
                    <label>Numéro d’immatriculation</label>
                    <input
                      className="input"
                      value={vehicleInfo.registration_number || ""}
                      onChange={(e) => handleVehicleInfoChange("registration_number", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Marque</label>
                    <input
                      className="input"
                      value={vehicleInfo.brand || ""}
                      onChange={(e) => handleVehicleInfoChange("brand", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Modèle</label>
                    <input
                      className="input"
                      value={vehicleInfo.model || ""}
                      onChange={(e) => handleVehicleInfoChange("model", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Cylindrée</label>
                    <input
                      className="input"
                      value={vehicleInfo.engine_displacement || ""}
                      onChange={(e) => handleVehicleInfoChange("engine_displacement", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Numéro de châssis</label>
                    <input
                      className="input"
                      value={vehicleInfo.chassis_number || ""}
                      onChange={(e) => handleVehicleInfoChange("chassis_number", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Couleur</label>
                    <input
                      className="input"
                      value={vehicleInfo.color || ""}
                      onChange={(e) => handleVehicleInfoChange("color", e.target.value)}
                    />
                  </div>
                </div>

                <h4>Affectation</h4>
                <div className="vehicle-extra-grid">
                  <div className="form-field">
                    <label>Nom de l’agent affecté</label>
                    <input
                      className="input"
                      value={vehicleInfo.assigned_agent_name || ""}
                      onChange={(e) => handleVehicleInfoChange("assigned_agent_name", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Contact agent</label>
                    <input
                      className="input"
                      value={vehicleInfo.assigned_agent_contact || ""}
                      onChange={(e) => handleVehicleInfoChange("assigned_agent_contact", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Matricule de l’agent</label>
                    <input
                      className="input"
                      value={vehicleInfo.assigned_agent_id_number || ""}
                      onChange={(e) => handleVehicleInfoChange("assigned_agent_id_number", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Fonction de l’agent</label>
                    <input
                      className="input"
                      value={vehicleInfo.assigned_agent_function || ""}
                      onChange={(e) => handleVehicleInfoChange("assigned_agent_function", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Zone / Région d’affectation</label>
                    <input
                      className="input"
                      value={vehicleInfo.assignment_region || ""}
                      onChange={(e) => handleVehicleInfoChange("assignment_region", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Statut de la moto</label>
                    <select
                      className="select"
                      value={vehicleInfo.vehicle_operational_status || "DISPONIBLE"}
                      onChange={(e) =>
                        handleVehicleInfoChange("vehicle_operational_status", e.target.value)
                      }
                    >
                      {VEHICLE_STATUS_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Responsable hiérarchique</label>
                    <input
                      className="input"
                      value={vehicleInfo.manager_name || ""}
                      onChange={(e) => handleVehicleInfoChange("manager_name", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Contact responsable</label>
                    <input
                      className="input"
                      value={vehicleInfo.manager_contact || ""}
                      onChange={(e) => handleVehicleInfoChange("manager_contact", e.target.value)}
                    />
                  </div>
                </div>

                <h4>Assurance et documents</h4>
                <div className="vehicle-extra-grid">
                  <div className="form-field">
                    <label>Compagnie d’assurance</label>
                    <input
                      className="input"
                      value={vehicleInfo.insurance_company || ""}
                      onChange={(e) => handleVehicleInfoChange("insurance_company", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Type d’assurance</label>
                    <select
                      className="select"
                      value={vehicleInfo.insurance_type || "TOUS_RISQUES"}
                      onChange={(e) => handleVehicleInfoChange("insurance_type", e.target.value)}
                    >
                      {INSURANCE_TYPE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Numéro de police</label>
                    <input
                      className="input"
                      value={vehicleInfo.policy_number || ""}
                      onChange={(e) => handleVehicleInfoChange("policy_number", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Statut assurance</label>
                    <input
                      className="input"
                      value={insuranceStatusLabel(vehicleInfo.insurance_status)}
                      readOnly
                      disabled
                    />
                    <small style={{ display: "block", marginTop: 6, color: "#5f6f83" }}>
                      Calcul automatique selon date du jour, date de début et date d'expiration.
                    </small>
                  </div>

                  <div className="form-field">
                    <label>Date début assurance</label>
                    <input
                      className="input"
                      type="date"
                      value={vehicleInfo.insurance_start_date || ""}
                      onChange={(e) => handleVehicleInfoChange("insurance_start_date", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Date expiration assurance</label>
                    <input
                      className="input"
                      type="date"
                      value={vehicleInfo.insurance_end_date || ""}
                      onChange={(e) => handleVehicleInfoChange("insurance_end_date", e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Carte grise (numéro)</label>
                    <input
                      className="input"
                      value={vehicleInfo.registration_card_number || ""}
                      onChange={(e) =>
                        handleVehicleInfoChange("registration_card_number", e.target.value)
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label>Carte grise (date)</label>
                    <input
                      className="input"
                      type="date"
                      value={vehicleInfo.registration_card_date || ""}
                      onChange={(e) =>
                        handleVehicleInfoChange("registration_card_date", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            )}

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
