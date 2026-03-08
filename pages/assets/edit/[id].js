import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../../../components/Layout";
import supabase from "../../../lib/supabaseClient";

export default function EditAsset() {
  const router = useRouter();
  const { id } = router.query;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [asset, setAsset] = useState(null);

  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "",
    value: "",
    status: "EN_SERVICE",
    description: "",
  });

  useEffect(() => {
    if (!id) return;
    fetchAsset();
  }, [id]);

  const fetchAsset = async () => {
    setLoading(true);

    // 1. Vérifier utilisateur connecté
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    // 2. Charger l'actif (RLS protège la société)
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      alert("Actif introuvable ou accès refusé");
      router.push("/assets");
      return;
    }

    setAsset(data);
    setForm({
      code: data.code || "",
      name: data.name || "",
      category: data.category || "",
      value: data.value ?? "",
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

    const { error } = await supabase
      .from("assets")
      .update({
        code: form.code,
        name: form.name,
        category: form.category,
        value: form.value ? Number(form.value) : null,
        status: form.status,
        description: form.description,
      })
      .eq("id", id);

    setSaving(false);

    if (error) {
      console.error(error);
      alert("Erreur lors de la mise à jour");
    } else {
      router.push(`/assets/${id}`);
    }
  };

  if (loading) {
    return (
      <Layout>
        <p>Chargement...</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>Éditer l’actif</h1>

      <form onSubmit={handleSubmit}>
        <div>
          <label>Code</label>
          <input
            name="code"
            value={form.code}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Nom *</label>
          <input
            name="name"
            required
            value={form.name}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Catégorie</label>
          <input
            name="category"
            value={form.category}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Valeur (Ar)</label>
          <input
            name="value"
            type="number"
            value={form.value}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Statut</label>
          <select
            name="status"
            value={form.status}
            onChange={handleChange}
          >
            <option value="EN_SERVICE">En service</option>
            <option value="EN_MAINTENANCE">En maintenance</option>
            <option value="HS">Hors service</option>
          </select>
        </div>

        <div>
          <label>Description</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
          />
        </div>

        <button type="submit" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>
    </Layout>
  );
}
