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

export default function NewAsset() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseValue, setPurchaseValue] = useState("");
  const [status, setStatus] = useState("EN_SERVICE");

  const [amortType, setAmortType] = useState("LINEAIRE");
  const [amortYears, setAmortYears] = useState(5);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [userOptions, setUserOptions] = useState([]);

  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");

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

  const formatEUR = (n) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(n || 0);
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  async function fetchCompanies() {
    const [{ data: orgs }, { user, profile }, users] = await Promise.all([
      supabase.from("organisations").select("id, name").order("name", { ascending: true }),
      getCurrentUserProfile(),
      fetchUserDirectoryList(),
    ]);

    setCompanies(orgs || []);
    setUserOptions(users || []);

    if (profile?.company_id) {
      setCompanyId(profile.company_id);
    }
    if (user?.id) {
      setAssignedToUserId(user.id);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setWarning("");
    setLoading(true);

    try {
      if (!name || !code || !category || !companyId) {
        throw new Error("Nom, Code, Catégorie et Société sont obligatoires.");
      }

      const purchaseVal = purchaseValue ? Number(purchaseValue) : null;
      const years = Number(amortYears);
      const amortAnnual = purchaseVal && years > 0 ? purchaseVal / years : null;
      const degressiveCoefficient = getDegressiveCoefficient(years);
      const degressiveRate = years > 0 ? (degressiveCoefficient / years) * 100 : null;

      const payload = {
        name,
        code,
        category,
        company_id: companyId,
        assigned_to_user_id: assignedToUserId || null,
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
      };

      const { data: createdAsset, error } = await supabase
        .from("assets")
        .insert([payload])
        .select("id")
        .single();

      if (error) throw error;

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
              <label>Code *</label>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>

            <div className="form-field">
              <label>Catégorie *</label>
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
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
              <select
                className="select"
                value={assignedToUserId}
                onChange={(e) => setAssignedToUserId(e.target.value)}
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
              <label>Valeur d’achat (€)</label>
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

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Description</label>
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
              <div className="amort-box">
                Amortissement lineaire estime : {formatEUR(annualLinearAmort)}
              </div>
              <div className="amort-box">
                Coefficient degressif : {degressivePreview.coefficient} | Taux degressif : {degressivePreview.rate.toFixed(2)}% | Annee 1 degressive : {formatEUR(degressivePreview.annual)}
              </div>
            </div>

            <div className="form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Piece jointe (optionnel)</label>
              <input
                className="input"
                type="file"
                onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              />
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
