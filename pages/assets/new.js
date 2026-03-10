import { useMemo, useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { getDegressiveCoefficient } from "../../lib/financeEngine";
import {
  saveAttachmentMetadata,
  uploadAssetAttachment,
} from "../../lib/attachmentService";
import { getCurrentUserProfile } from "../../lib/accessControl";
import { fetchUserDirectoryList } from "../../lib/userDirectory";
import { formatMGA } from "../../lib/currency";
import { FIXED_ASSET_CATEGORIES } from "../../lib/assetCategories";
import { ASSET_CONDITIONS } from "../../lib/assetConditions";
import {
  computeInsuranceStatusByDates,
  DEFAULT_VEHICLE_INFO,
  INSURANCE_TYPE_OPTIONS,
  VEHICLE_STATUS_OPTIONS,
  isVehicleCategory,
  insuranceStatusLabel,
  normalizeVehicleInfo,
} from "../../lib/vehicleInfo";

export default function NewAsset() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [currentCondition, setCurrentCondition] = useState("BON");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseValue, setPurchaseValue] = useState("");
  const [status, setStatus] = useState("EN_SERVICE");

  const [amortType, setAmortType] = useState("LINEAIRE");
  const [amortYears, setAmortYears] = useState(5);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [userOptions, setUserOptions] = useState([]);
  const [vehicleInfo, setVehicleInfo] = useState(DEFAULT_VEHICLE_INFO);

  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const isVehicleAsset = isVehicleCategory(category);

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

  const annualLinearAmort = useMemo(() => {
    const value = Number(purchaseValue);
    const years = Number(amortYears);
    if (!value || !years || years <= 0) return 0;
    return value / years;
  }, [purchaseValue, amortYears]);

  const degressivePreview = useMemo(() => {
    const value = Number(purchaseValue);
    const years = Number(amortYears);
    if (!value || !years || years <= 0) return { coefficient: 1, rate: 0, annual: 0 };

    const coefficient = getDegressiveCoefficient(years);
    const rate = (coefficient / years) * 100;
    return {
      coefficient,
      rate,
      annual: value * (rate / 100),
    };
  }, [purchaseValue, amortYears]);

  useEffect(() => {
    fetchCompanies();
  }, []);

  async function fetchCompanies() {
    const [{ data: orgs }, { profile }, users] = await Promise.all([
      supabase.from("organisations").select("id, name").order("name", { ascending: true }),
      getCurrentUserProfile(),
      fetchUserDirectoryList(),
    ]);

    setCompanies(orgs || []);
    setUserOptions(users || []);

    if (profile?.company_id) {
      setCompanyId(profile.company_id);
    }
  }

  function handleAssignedNameChange(value) {
    setAssignedToName(value);
    if (assignedToUserId) {
      setAssignedToUserId("");
    }
  }

  function handleAssignedUserChange(userId) {
    setAssignedToUserId(userId);
    if (!userId) return;
    const selectedUser = userOptions.find((item) => item.id === userId);
    if (!selectedUser) return;
    setAssignedToName(
      selectedUser.full_name || selectedUser.label || selectedUser.email || selectedUser.id
    );
  }

  function handleVehicleInfoChange(field, value) {
    setVehicleInfo((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setWarning("");
    setLoading(true);

    try {
      if (!name || !category || !companyId) {
        throw new Error("Nom, Catégorie et Société sont obligatoires.");
      }

      const purchaseVal = purchaseValue ? Number(purchaseValue) : null;
      const years = Number(amortYears);
      const amortAnnual = purchaseVal && years > 0 ? purchaseVal / years : null;
      const degressiveCoefficient = getDegressiveCoefficient(years);
      const degressiveRate = years > 0 ? (degressiveCoefficient / years) * 100 : null;
      const computedInsuranceStatus = computeInsuranceStatusByDates(
        vehicleInfo.insurance_start_date,
        vehicleInfo.insurance_end_date
      );
      const normalizedVehicleDetails = isVehicleAsset
        ? normalizeVehicleInfo({
            ...vehicleInfo,
            insurance_status: computedInsuranceStatus,
          })
        : null;

      const payload = {
        name,
        code: code.trim() || null,
        category,
        current_condition: currentCondition || null,
        company_id: companyId,
        assigned_to_user_id: assignedToUserId || null,
        assigned_to_name: assignedToName.trim() || null,
        purchase_date: purchaseDate || null,
        purchase_value: purchaseVal,
        status,
        description: description || null,

        // ✅ COLONNES EXACTES SUPABASE
        amortissement_type: amortType,
        amortissement_duration: years,
        amortissement_method: amortType,
        amortissement_rate: amortAnnual,
        amortissement_degressive_rate: degressiveRate,
        amortissement_degressive_coefficient: degressiveCoefficient,
        duration: years,
        value: purchaseVal,
        vehicle_details: normalizedVehicleDetails,
      };

      let createdAsset = null;
      let error = null;
      let insertPayload = { ...payload };
      const fallbackWarnings = [];

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const insertResponse = await supabase
          .from("assets")
          .insert([insertPayload])
          .select("id")
          .single();

        createdAsset = insertResponse.data;
        error = insertResponse.error;
        if (!error) break;

        const errorMessage = String(error.message || "").toLowerCase();
        let patched = false;

        if (
          errorMessage.includes("assigned_to_name") &&
          Object.prototype.hasOwnProperty.call(insertPayload, "assigned_to_name")
        ) {
          delete insertPayload.assigned_to_name;
          fallbackWarnings.push(
            "Actif cree sans le nom libre d'attribution. Execute la migration SQL de colonne assigned_to_name."
          );
          patched = true;
        }

        if (
          errorMessage.includes("vehicle_details") &&
          Object.prototype.hasOwnProperty.call(insertPayload, "vehicle_details")
        ) {
          delete insertPayload.vehicle_details;
          fallbackWarnings.push(
            "Actif cree sans les informations véhicule. Execute la migration SQL de colonne vehicle_details."
          );
          patched = true;
        }

        if (!patched) break;
      }

      if (error) throw error;
      if (fallbackWarnings.length) {
        setWarning(Array.from(new Set(fallbackWarnings)).join(" "));
      }

      if (attachmentFile && createdAsset?.id) {
        try {
          const uploaded = await uploadAssetAttachment({
            assetId: createdAsset.id,
            file: attachmentFile,
          });
          await saveAttachmentMetadata({
            assetId: createdAsset.id,
            fileName: uploaded.fileName,
            path: uploaded.path,
            publicUrl: uploaded.publicUrl,
            thumbnailPath: uploaded.thumbnailPath,
            thumbnailUrl: uploaded.thumbnailUrl,
          });
        } catch (attachmentError) {
          setWarning(
            `Actif cree, mais la piece jointe n'a pas ete enregistree: ${attachmentError.message}`
          );
        }
      }

      router.push("/assets");

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <h1>Ajouter un actif</h1>

      {error && (
        <div className="alert-error">
          Erreur : {error}
        </div>
      )}
      {warning && <div className="alert-warning">{warning}</div>}

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">

            <div className="form-field">
              <label>Nom *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="form-field">
              <label>Code (optionnel)</label>
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Laisser vide pour génération auto (SOC-CAT-YY-####)"
              />
              <small style={{ display: "block", marginTop: 6, color: "#5f6f83" }}>
                Si vide, le code est généré automatiquement avec compteur incrémental.
              </small>
            </div>

            <div className="form-field">
              <label>Catégorie *</label>
              <select
                className="select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                <option value="">Sélectionner une catégorie</option>
                {FIXED_ASSET_CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Etat actuel *</label>
              <select
                className="select"
                value={currentCondition}
                onChange={(e) => setCurrentCondition(e.target.value)}
                required
              >
                {ASSET_CONDITIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Société *</label>
              <select
                className="select"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                required
              >
                <option value="">Sélectionner une société</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Attribué à</label>
              <input
                className="input"
                value={assignedToName}
                onChange={(e) => handleAssignedNameChange(e.target.value)}
                placeholder="Tapez le nom de la personne"
              />
              <small style={{ display: "block", marginTop: 6, color: "#5f6f83" }}>
                Saisie libre. Optionnel: sélectionner un utilisateur existant.
              </small>
            </div>

            <div className="form-field">
              <label>Utilisateur existant (optionnel)</label>
              <select
                className="select"
                value={assignedToUserId}
                onChange={(e) => handleAssignedUserChange(e.target.value)}
              >
                <option value="">Non attribué</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email || user.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Statut</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="EN_SERVICE">EN_SERVICE</option>
                <option value="EN_MAINTENANCE">EN_MAINTENANCE</option>
                <option value="HS">HS</option>
              </select>
            </div>

            <div className="form-field">
              <label>Date d’achat</label>
              <input type="date" className="input" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>

            <div className="form-field">
              <label>Valeur d’achat (Ar)</label>
              <input type="number" className="input" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} />
            </div>

            <div className="form-field">
              <label>Type d’amortissement</label>
              <select className="select" value={amortType} onChange={(e) => setAmortType(e.target.value)}>
                <option value="LINEAIRE">Linéaire</option>
                <option value="DEGRESSIF">Dégressif</option>
              </select>
            </div>

            <div className="form-field">
              <label>Durée (années)</label>
              <input type="number" className="input" value={amortYears} onChange={(e) => setAmortYears(e.target.value)} />
            </div>

            {isVehicleAsset && (
              <div className="vehicle-extra-section">
                <h3>Informations véhicule</h3>
                <p>
                  Ce bloc est affiché uniquement pour les catégories Vehicule - Moto et Vehicule - Voiture.
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
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
              <div className="amort-box">
                Amortissement lineaire estime : {formatMGA(annualLinearAmort)}
              </div>
              <div className="amort-box">
                Coefficient degressif : {degressivePreview.coefficient} | Taux degressif : {degressivePreview.rate.toFixed(2)}% | Annee 1 degressive : {formatMGA(degressivePreview.annual)}
              </div>
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Piece jointe (optionnel)</label>
              <input
                className="input"
                type="file"
                onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              />
              <small style={{ display: "block", marginTop: 6, color: "#5f6f83" }}>
                Taille max: 10 MB. Les images sont converties en WebP + miniature avant envoi.
              </small>
            </div>

          </div>

          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Création..." : "Créer l’actif"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
