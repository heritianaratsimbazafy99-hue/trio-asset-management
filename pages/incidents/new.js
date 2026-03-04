import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import Layout from "../../components/Layout";

export default function NewIncident() {
  const router = useRouter();
  const { asset_id } = router.query;

  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
      .select("id,name,code")
      .order("name", { ascending: true });
    setAssets(data || []);
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
      .from("incidents")
      .insert([
        {
          asset_id: selectedAssetId,
          title,
          description,
          status: "OUVERT",
          reported_by: user?.id || null,
          resolved_by: null,
          resolved_at: null,
        },
      ]);

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(`/assets/${selectedAssetId}`);
  }

  return (
    <Layout>
      <h1>Signaler un incident</h1>

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
            required
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
          <label>Statut initial</label>
          <input className="input" value="OUVERT" readOnly />
        </div>

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Création..." : "Créer incident"}
        </button>
      </form>
    </Layout>
  );
}
