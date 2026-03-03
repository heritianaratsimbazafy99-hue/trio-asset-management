import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

// Supabase client setup. If you need to update the URL or anon key
// you can do so via environment variables. Using environment variables
// allows you to provide different values for development and production.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function EditIncident() {
  const router = useRouter();
  const { id } = router.query;
  const [incident, setIncident] = useState(null);
  const [formState, setFormState] = useState({ description: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch the incident when the component mounts or the id changes
  useEffect(() => {
    if (!id) return;
    async function fetchIncident() {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .eq('id', id)
        .single();
      if (error) {
        setError('Erreur lors du chargement de l\'incident');
      } else {
        setIncident(data);
        setFormState({ description: data.description || '', status: data.status || 'OUVERT' });
      }
      setLoading(false);
    }
    fetchIncident();
  }, [id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const { description, status } = formState;
    const { error } = await supabase
      .from('incidents')
      .update({ description, status })
      .eq('id', id);
    if (error) {
      setError('Erreur lors de la mise à jour de l\'incident');
    } else {
      router.push('/incidents');
    }
  }

  if (loading) {
    return <p>Chargement…</p>;
  }
  if (error) {
    return <p>{error}</p>;
  }
  if (!incident) {
    return <p>Aucun incident trouvé.</p>;
  }

  return (
    <div className="container">
      <h1 className="page-title">Modifier l\'incident</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Description:
          <textarea
            value={formState.description}
            onChange={(e) => setFormState({ ...formState, description: e.target.value })}
          />
        </label>
        <label>
          Statut:
          <select
            value={formState.status}
            onChange={(e) => setFormState({ ...formState, status: e.target.value })}
          >
            {/* Use uppercase keys to match how statuses are stored in the database. */}
            <option value="OUVERT">Ouvert</option>
            <option value="EN_COURS">En cours</option>
            <option value="RESOLU">Résolu</option>
          </select>
        </label>
        <button type="submit" className="primary-button">Enregistrer</button>
      </form>
    </div>
  );
}