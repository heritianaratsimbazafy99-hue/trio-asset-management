import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";

export default function NewMaintenance() {
  const router = useRouter();
  const { asset_id } = router.query;

  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [priority, setPriority] = useState("MOYENNE");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAssets();
  }, []);

  useEffect(() => {
    if (!asset_id) return;
    setAssetId(String(asset_id));
  }, [asset_id]);

  async function fetchAssets() {
    const { data } = await supabase
      .from("assets")
      .select("id,name,code,status")
      .order("name", { ascending: true });
    setAssets((data || []).filter((item) => String(item.status || "").toUpperCase() !== "REBUS"));
  }

  const selectedAssetId = useMemo(() => assetId || String(asset_id || ""), [assetId, asset_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!selectedAssetId) {
      setError("Asset ID manquant.");
      setLoading(false);
      return;
    }

    if (!title) {
      setError("Titre obligatoire.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.rpc("request_maintenance_start", {
      p_asset_id: selectedAssetId,
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_cost: Number(cost || 0),
      p_priority: priority,
      p_due_date: dueDate || null,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(
      `/assets/${selectedAssetId}?flash=${encodeURIComponent(
        "Ticket maintenance créé. Statut: en attente de validation."
      )}`
    );
  }

  return (
    <Layout>
      <h1>Planifier une maintenance</h1>
      <div className="alert-warning" style={{ marginBottom: 14 }}>
        Toute nouvelle maintenance passe désormais par un ticket puis par une validation avant passage en cours.
      </div>

      {error && <div className="alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="card">
        <div className="form-field">
          <label>Actif *</label>
          <select
            className="select"
            value={selectedAssetId}
            onChange={(e) => setAssetId(e.target.value)}
            required
          >
            <option value="">Sélectionner un actif</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} {asset.code ? `(${asset.code})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Titre *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label>Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label>Coût (Ar)</label>
          <input
            type="number"
            className="input"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label>Priorité</label>
          <select
            className="select"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="BASSE">Basse</option>
            <option value="MOYENNE">Moyenne</option>
            <option value="HAUTE">Haute</option>
            <option value="CRITIQUE">Critique</option>
          </select>
        </div>

        <div className="form-field">
          <label>Deadline SLA (date limite)</label>
          <input
            type="date"
            className="input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <button type="submit" disabled={loading} className="btn-warning">
          {loading ? "Création..." : "Créer maintenance"}
        </button>
      </form>
    </Layout>
  );
}
