import { useEffect, useState } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../lib/accessControl";
import {
  buildRoutingUpsertRows,
  buildTemplateUpsertRows,
  isRoutingRoleAllowed,
  normalizeRoutingRows,
  normalizeTemplateRows,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_ROUTING_ROLES,
  NOTIFICATION_ROUTING_ROLE_LABELS,
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
} from "../../lib/notificationGovernance";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function buildGovernanceScenarioKey(row) {
  return `${String(row?.notification_type || "").toUpperCase()}::${String(
    row?.request_type || "ANY"
  ).toUpperCase()}`;
}

function normalizeTemplateComparableRow(row) {
  return {
    notification_type: row?.notification_type || "",
    request_type: row?.request_type || "ANY",
    template_name: row?.template_name || "",
    email_subject_template: row?.email_subject_template || "",
    title_template: row?.title_template || "",
    body_template: row?.body_template || "",
    cta_label: row?.cta_label || "",
    is_enabled: row?.is_enabled !== false,
  };
}

function normalizeRoutingComparableRow(row) {
  return {
    notification_type: row?.notification_type || "",
    request_type: row?.request_type || "ANY",
    channels: row?.channels || {},
  };
}

export default function NotificationGovernancePage() {
  const [userRole, setUserRole] = useState("");
  const [actorId, setActorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [templateRows, setTemplateRows] = useState([]);
  const [routingRows, setRoutingRows] = useState([]);
  const [initialTemplateRows, setInitialTemplateRows] = useState([]);
  const [initialRoutingRows, setInitialRoutingRows] = useState([]);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError("");
    setMessage("");

    const { user, profile } = await getCurrentUserProfile();
    setUserRole(profile?.role || "");
    setActorId(profile?.id || user?.id || "");

    if (!hasOneRole(profile?.role, [APP_ROLES.CEO, APP_ROLES.DAF])) {
      setLoading(false);
      return;
    }

    await fetchGovernance();
    setLoading(false);
  }

  async function fetchGovernance() {
    const [templatesResponse, routingResponse] = await Promise.all([
      supabase
        .from("notification_template_configs")
        .select(
          "notification_type, request_type, template_name, email_subject_template, title_template, body_template, cta_label, is_enabled, updated_at"
        )
        .order("notification_type", { ascending: true })
        .order("request_type", { ascending: true }),
      supabase
        .from("notification_routing_rules")
        .select("notification_type, request_type, channel, role, is_enabled")
        .order("notification_type", { ascending: true })
        .order("request_type", { ascending: true })
        .order("channel", { ascending: true })
        .order("role", { ascending: true }),
    ]);

    if (templatesResponse.error || routingResponse.error) {
      setError(
        templatesResponse.error?.message ||
          routingResponse.error?.message ||
          "Impossible de charger la gouvernance."
      );
      setTemplateRows([]);
      setRoutingRows([]);
      return;
    }

    const normalizedTemplates = normalizeTemplateRows(templatesResponse.data || []);
    const normalizedRouting = normalizeRoutingRows(routingResponse.data || []);

    setTemplateRows(normalizedTemplates);
    setRoutingRows(normalizedRouting);
    setInitialTemplateRows(normalizedTemplates);
    setInitialRoutingRows(normalizedRouting);
  }

  function updateTemplate(index, field, value) {
    setTemplateRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: field === "is_enabled" ? Boolean(value) : value,
            }
          : row
      )
    );
  }

  function toggleRouting(index, channel, role) {
    setRoutingRows((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index || !isRoutingRoleAllowed(row, role)) return row;
        return {
          ...row,
          channels: {
            ...row.channels,
            [channel]: {
              ...row.channels[channel],
              [role]: !row.channels[channel][role],
            },
          },
        };
      })
    );
  }

  async function saveGovernance() {
    setSaving(true);
    setError("");
    setMessage("");

    const initialTemplateMap = new Map(
      initialTemplateRows.map((row) => [buildGovernanceScenarioKey(row), row])
    );
    const initialRoutingMap = new Map(
      initialRoutingRows.map((row) => [buildGovernanceScenarioKey(row), row])
    );

    const changedTemplateRows = templateRows.filter((row) => {
      const previous = initialTemplateMap.get(buildGovernanceScenarioKey(row));
      return (
        JSON.stringify(normalizeTemplateComparableRow(row)) !==
        JSON.stringify(normalizeTemplateComparableRow(previous))
      );
    });

    const changedRoutingRows = routingRows.filter((row) => {
      const previous = initialRoutingMap.get(buildGovernanceScenarioKey(row));
      return (
        JSON.stringify(normalizeRoutingComparableRow(row)) !==
        JSON.stringify(normalizeRoutingComparableRow(previous))
      );
    });

    if (!changedTemplateRows.length && !changedRoutingRows.length) {
      setMessage("Aucun changement à enregistrer.");
      setSaving(false);
      return;
    }

    const [templatesUpsert, routingUpsert] = await Promise.all([
      changedTemplateRows.length
        ? supabase
            .from("notification_template_configs")
            .upsert(buildTemplateUpsertRows(changedTemplateRows, actorId || null), {
              onConflict: "notification_type,request_type",
            })
        : Promise.resolve({ error: null }),
      changedRoutingRows.length
        ? supabase
            .from("notification_routing_rules")
            .upsert(buildRoutingUpsertRows(changedRoutingRows, actorId || null), {
              onConflict: "notification_type,request_type,channel,role",
            })
        : Promise.resolve({ error: null }),
    ]);

    if (templatesUpsert.error || routingUpsert.error) {
      setError(
        templatesUpsert.error?.message ||
          routingUpsert.error?.message ||
          "Impossible d'enregistrer la gouvernance."
      );
      setSaving(false);
      return;
    }

    setMessage("Gouvernance des notifications enregistrée.");
    await fetchGovernance();
    setSaving(false);
  }

  const canAccess = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);

  if (loading) {
    return (
      <Layout>
        <p>Chargement...</p>
      </Layout>
    );
  }

  if (!canAccess) {
    return (
      <Layout>
        <h1>Gouvernance des notifications</h1>
        <div className="alert-error">Accès réservé au CEO et DAF.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>Gouvernance des notifications</h1>
      <p style={{ marginBottom: 12 }}>
        Rôle connecté: {userRole || "-"} | Les règles ci-dessous pilotent les canaux et les modèles
        sans changer le code.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="dashboard-header-row" style={{ marginBottom: 10 }}>
          <div>
            <h3>Cadre de gouvernance</h3>
            <p style={{ color: "var(--muted)", marginTop: 4 }}>
              Les tickets maintenance en attente restent limités aux approbateurs CEO et DAF. Les
              règles de routage complètent les rôles d'approbation, elles ne les élargissent pas.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={fetchGovernance} disabled={saving}>
              Recharger
            </button>
            <button className="btn-primary" onClick={saveGovernance} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>

        <div className="notification-governance-meta">
          <span>Placeholders disponibles:</span>
          {NOTIFICATION_TEMPLATE_PLACEHOLDERS.map((item) => (
            <code key={item}>{item}</code>
          ))}
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Routage par scénario</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="table notification-governance-table">
            <thead>
              <tr>
                <th>Scénario</th>
                {Object.entries(NOTIFICATION_CHANNEL_LABELS).flatMap(([channel, label]) =>
                  NOTIFICATION_ROUTING_ROLES.map((role) => (
                    <th key={`${channel}-${role}`}>
                      <div>{label}</div>
                      <small>{NOTIFICATION_ROUTING_ROLE_LABELS[role]}</small>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {routingRows.map((row, index) => (
                <tr key={`${row.notification_type}-${row.request_type}`}>
                  <td className="notification-governance-scenario">
                    <strong>{row.title}</strong>
                    <div>{row.description}</div>
                  </td>
                  {Object.keys(NOTIFICATION_CHANNEL_LABELS).flatMap((channel) =>
                    NOTIFICATION_ROUTING_ROLES.map((role) => {
                      const allowed = isRoutingRoleAllowed(row, role);
                      return (
                        <td key={`${row.notification_type}-${row.request_type}-${channel}-${role}`}>
                          <label className="notification-toggle-cell">
                            <input
                              type="checkbox"
                              className="notification-toggle"
                              checked={allowed ? Boolean(row.channels?.[channel]?.[role]) : false}
                              disabled={!allowed}
                              onChange={() => toggleRouting(index, channel, role)}
                            />
                          </label>
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notification-governance-template-grid">
        {templateRows.map((row, index) => (
          <div
            key={`${row.notification_type}-${row.request_type}`}
            className="card notification-template-card"
          >
            <div className="dashboard-header-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>{row.template_name || row.notification_type}</h3>
                <p style={{ color: "var(--muted)", marginTop: 4 }}>
                  {row.notification_type} / {row.request_type} | Dernière mise à jour:{" "}
                  {formatDate(row.updated_at)}
                </p>
              </div>
              <label className="notification-template-enabled">
                <input
                  type="checkbox"
                  className="notification-toggle"
                  checked={row.is_enabled !== false}
                  onChange={(event) => updateTemplate(index, "is_enabled", event.target.checked)}
                />
                Actif
              </label>
            </div>

            <div className="form-grid-2" style={{ marginBottom: 12 }}>
              <div>
                <label>Nom du modèle</label>
                <input
                  className="input"
                  value={row.template_name || ""}
                  onChange={(event) => updateTemplate(index, "template_name", event.target.value)}
                />
              </div>
              <div>
                <label>CTA</label>
                <input
                  className="input"
                  value={row.cta_label || ""}
                  onChange={(event) => updateTemplate(index, "cta_label", event.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Sujet email</label>
              <input
                className="input"
                value={row.email_subject_template || ""}
                onChange={(event) =>
                  updateTemplate(index, "email_subject_template", event.target.value)
                }
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Titre notification</label>
              <input
                className="input"
                value={row.title_template || ""}
                onChange={(event) => updateTemplate(index, "title_template", event.target.value)}
              />
            </div>

            <div>
              <label>Corps</label>
              <textarea
                className="textarea"
                rows={5}
                value={row.body_template || ""}
                onChange={(event) => updateTemplate(index, "body_template", event.target.value)}
              />
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
