import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/router";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    restoreEmail();
    checkExistingSession();
  }, []);

  async function checkExistingSession() {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      router.push("/assets");
    }
  }

  function restoreEmail() {
    if (typeof window === "undefined") return;
    const savedEmail = localStorage.getItem("remembered_login_email");
    if (savedEmail) {
      setEmail(savedEmail);
    }
  }

  function toFrenchError(message) {
    const m = String(message || "").toLowerCase();
    if (m.includes("invalid login credentials")) {
      return "Identifiants invalides. Vérifie ton email et ton mot de passe.";
    }
    if (m.includes("email not confirmed")) {
      return "Email non confirmé. Vérifie ta boîte mail.";
    }
    if (m.includes("network")) {
      return "Erreur réseau. Vérifie ta connexion internet.";
    }
    return message || "Erreur de connexion.";
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(toFrenchError(error.message));
    } else {
      if (typeof window !== "undefined") {
        if (rememberEmail) {
          localStorage.setItem("remembered_login_email", email);
        } else {
          localStorage.removeItem("remembered_login_email");
        }
      }
      router.push("/assets");
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-info-panel">
          <img src="/trio-logo.svg" alt="Groupe Trio" className="login-logo" />
          <div className="login-badge">TRIO ASSET</div>
          <h1>Pilotage Immobilisations Groupe</h1>
          <p>
            Connecte-toi pour suivre les actifs, incidents, maintenances et indicateurs CFO.
          </p>
          <div className="login-points">
            <div>Visibilité multi-sociétés</div>
            <div>Contrôle rôles CEO / Maintenance</div>
            <div>Décisionnel prédictif & audit</div>
          </div>
        </div>

        <div className="login-card-modern">
          <h2>Connexion</h2>
          <p className="login-subtitle">Accès sécurisé à la plateforme de gestion d'actifs.</p>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-field">
              <label>Email</label>
              <input
                className="input"
                type="email"
                placeholder="nom@entreprise.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-field">
              <label>Mot de passe</label>
              <div className="login-password-row">
                <input
                  className="input"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="btn-secondary login-toggle-btn"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Masquer" : "Afficher"}
                </button>
              </div>
            </div>

            <label className="login-checkbox">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => setRememberEmail(e.target.checked)}
              />
              Mémoriser mon email sur cet appareil
            </label>

            {error && <div className="alert-error">{error}</div>}

            <button type="submit" className="btn-primary login-submit-btn" disabled={loading}>
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
