import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../../components/Layout";
import { supabase } from "../../../lib/supabaseClient";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../../../lib/accessControl";
import { fetchUserDirectoryMapByIds, getUserLabelById } from "../../../lib/userDirectory";

function toTs(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function eventLabel(item) {
  const type = String(item.event_type || "");
  if (type === "INCIDENT_REPORTED") return "Incident signalé";
  if (type === "INCIDENT_CLOSED") return "Incident clôturé";
  if (type === "MAINTENANCE_REPORTED") return "Maintenance signalée";
  if (type === "MAINTENANCE_CLOSED") return "Maintenance clôturée";
  if (type === "ASSET_UPDATED") return "Modification actif";
  if (type === "ASSET_ASSIGNMENT_INITIAL") return "Attribution initiale";
  if (type === "ASSET_ASSIGNMENT_CHANGE") return "Changement attribution";
  if (type === "AUDIT") return "Action audit";
  return type || "Événement";
}

function getAssignmentLabel(usersMap, userId, name) {
  const fromUser = userId ? getUserLabelById(usersMap, userId) : "";
  if (fromUser && fromUser !== userId) return fromUser;
  if (name) return name;
  if (fromUser && fromUser !== "-") return fromUser;
  return "-";
}

function formatChangeValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatAssetDiff(diff) {
  if (!diff || typeof diff !== "object") return "Modification actif";
  const entries = Object.entries(diff);
  if (!entries.length) return "Modification actif";
  return entries
    .map(([field, change]) => {
      const before = formatChangeValue(change?.before);
      const after = formatChangeValue(change?.after);
      return `${field}: ${before} -> ${after}`;
    })
    .join(" | ");
}

export default function AssetJournalPage() {
  const router = useRouter();
  const { id } = router.query;

  const [asset, setAsset] = useState(null);
  const [events, setEvents] = useState([]);
  const [usersMap, setUsersMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eventFilter, setEventFilter] = useState("ALL");
  const [canReadAudit, setCanReadAudit] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchJournal(id);
  }, [id]);

  async function fetchJournal(assetId) {
    setLoading(true);
    setError("");

    const { profile } = await getCurrentUserProfile();
    const allowAudit = hasOneRole(profile?.role, [APP_ROLES.CEO, APP_ROLES.DAF]);
    setCanReadAudit(allowAudit);

    const emptyAudit = { data: [], error: null };
    const [
      { data: assetData, error: assetError },
      { data: incidentsData, error: incidentsError },
      { data: maintenanceData, error: maintenanceError },
      { data: assetChangeData, error: assetChangeError },
      { data: assignmentData, error: assignmentError },
      { data: auditAssetRows },
      { data: auditPayloadRows },
    ] = await Promise.all([
      supabase.from("assets").select("id,name,code").eq("id", assetId).single(),
      supabase
        .from("incidents")
        .select("id,title,description,status,created_at,resolved_at,reported_by,resolved_by")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false }),
      supabase
        .from("maintenance")
        .select("id,title,description,status,cost,created_at,completed_at,reported_by,completed_by")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false }),
      supabase
        .from("asset_change_history")
        .select("id,asset_id,actor_user_id,changed_fields,diff,before_snapshot,after_snapshot,change_source,change_reason,created_at")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false }),
      supabase
        .from("asset_assignment_history")
        .select("*")
        .eq("asset_id", assetId)
        .order("changed_at", { ascending: false }),
      allowAudit
        ? supabase
            .from("audit_logs")
            .select("id,actor_user_id,action,entity_type,entity_id,payload,created_at")
            .eq("entity_type", "assets")
            .eq("entity_id", assetId)
            .order("created_at", { ascending: false })
        : Promise.resolve(emptyAudit),
      allowAudit
        ? supabase
            .from("audit_logs")
            .select("id,actor_user_id,action,entity_type,entity_id,payload,created_at")
            .contains("payload", { asset_id: assetId })
            .order("created_at", { ascending: false })
        : Promise.resolve(emptyAudit),
    ]);

    if (assetError || incidentsError || maintenanceError || assetChangeError || assignmentError) {
      setError(
        assetError?.message ||
          incidentsError?.message ||
          maintenanceError?.message ||
          assetChangeError?.message ||
          assignmentError?.message ||
          "Erreur de chargement du journal."
      );
      setLoading(false);
      return;
    }

    setAsset(assetData || null);

    const incidentEvents = [];
    (incidentsData || []).forEach((item) => {
      incidentEvents.push({
        id: `incident-reported-${item.id}`,
        date: item.created_at,
        event_type: "INCIDENT_REPORTED",
        actor_user_id: item.reported_by,
        details: `${item.title || item.description || "Incident"} (${item.status || "-"})`,
        source: "incidents",
      });
      if (item.resolved_at) {
        incidentEvents.push({
          id: `incident-closed-${item.id}`,
          date: item.resolved_at,
          event_type: "INCIDENT_CLOSED",
          actor_user_id: item.resolved_by,
          details: `${item.title || item.description || "Incident"} (RESOLU)`,
          source: "incidents",
        });
      }
    });

    const maintenanceEvents = [];
    (maintenanceData || []).forEach((item) => {
      maintenanceEvents.push({
        id: `maintenance-reported-${item.id}`,
        date: item.created_at,
        event_type: "MAINTENANCE_REPORTED",
        actor_user_id: item.reported_by,
        details: `${item.title || item.description || "Maintenance"} - Coût: ${Number(item.cost || 0)}`,
        source: "maintenance",
      });
      if (item.completed_at) {
        maintenanceEvents.push({
          id: `maintenance-closed-${item.id}`,
          date: item.completed_at,
          event_type: "MAINTENANCE_CLOSED",
          actor_user_id: item.completed_by,
          details: `${item.title || item.description || "Maintenance"} (TERMINEE)`,
          source: "maintenance",
        });
      }
    });

    const assignmentEvents = (assignmentData || []).map((item) => ({
      id: `assignment-${item.id}`,
      date: item.changed_at,
      event_type: item.note === "ASSIGNMENT_INITIAL" ? "ASSET_ASSIGNMENT_INITIAL" : "ASSET_ASSIGNMENT_CHANGE",
      actor_user_id: item.changed_by,
      previous_assigned_to: item.previous_assigned_to,
      new_assigned_to: item.new_assigned_to,
      previous_assigned_name: item.previous_assigned_name,
      new_assigned_name: item.new_assigned_name,
      details: "Attribution actif",
      source: "asset_assignment_history",
    }));

    const assetUpdateEvents = (assetChangeData || []).map((item) => ({
      id: `asset-update-${item.id}`,
      date: item.created_at,
      event_type: "ASSET_UPDATED",
      actor_user_id: item.actor_user_id,
      changed_fields: item.changed_fields || [],
      diff: item.diff || {},
      details: [
        item.change_source ? `Source: ${item.change_source}` : "",
        item.change_reason ? `Motif: ${item.change_reason}` : "",
        formatAssetDiff(item.diff),
      ]
        .filter(Boolean)
        .join(" | "),
      source: "asset_change_history",
    }));

    const mergedAudit = [
      ...(auditAssetRows || []),
      ...(auditPayloadRows || []),
    ];

    const seenAuditIds = new Set();
    const auditEvents = mergedAudit
      .filter((item) => {
        if (seenAuditIds.has(item.id)) return false;
        seenAuditIds.add(item.id);
        return true;
      })
      .map((item) => ({
        id: `audit-${item.id}`,
        date: item.created_at,
        event_type: "AUDIT",
        audit_action: item.action,
        actor_user_id: item.actor_user_id,
        details: `${item.action} - ${item.entity_type}:${item.entity_id}`,
        source: "audit_logs",
      }));

    const merged = [
      ...incidentEvents,
      ...maintenanceEvents,
      ...assetUpdateEvents,
      ...assignmentEvents,
      ...auditEvents,
    ].sort((a, b) => toTs(b.date) - toTs(a.date));

    setEvents(merged);

    const userIds = merged
      .flatMap((item) => [item.actor_user_id, item.previous_assigned_to, item.new_assigned_to])
      .filter(Boolean);
    const userMap = await fetchUserDirectoryMapByIds(userIds);
    setUsersMap(userMap);

    setLoading(false);
  }

  const eventOptions = useMemo(() => {
    const base = ["ALL"];
    const unique = Array.from(new Set(events.map((item) => item.event_type)));
    return [...base, ...unique];
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((item) => eventFilter === "ALL" || item.event_type === eventFilter);
  }, [events, eventFilter]);

  return (
    <Layout>
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/assets">Immobilisations</Link> /{" "}
            {id ? <Link href={`/assets/${id}`}>Fiche actif</Link> : "Fiche actif"} / Journal
          </div>
          <h1>Journal par actif</h1>
          <p className="page-subtitle">
            {asset ? `${asset.name}${asset.code ? ` (${asset.code})` : ""}` : "Chargement actif..."}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12 }}>
          <select
            className="select"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            {eventOptions.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "Tous les événements" : item}
              </option>
            ))}
          </select>

          <button className="btn-secondary" onClick={() => id && fetchJournal(id)}>
            Actualiser
          </button>

          <button className="btn-primary" onClick={() => router.push(`/assets/${id}`)}>
            Retour fiche actif
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {!canReadAudit && (
        <div className="alert-warning" style={{ marginBottom: 12 }}>
          Les événements d'audit avancés sont réservés au CEO/DAF.
        </div>
      )}

      <div className="card">
        {loading ? (
          <p>Chargement du journal...</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Événement</th>
                <th>Utilisateur</th>
                <th>Détails</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((item) => {
                const actor = getUserLabelById(usersMap, item.actor_user_id);
                const oldAssignee = getAssignmentLabel(
                  usersMap,
                  item.previous_assigned_to,
                  item.previous_assigned_name
                );
                const newAssignee = getAssignmentLabel(
                  usersMap,
                  item.new_assigned_to,
                  item.new_assigned_name
                );
                const assignmentDelta =
                  item.event_type === "ASSET_ASSIGNMENT_INITIAL" || item.event_type === "ASSET_ASSIGNMENT_CHANGE"
                    ? ` | de ${oldAssignee} vers ${newAssignee}`
                    : "";

                return (
                  <tr key={item.id}>
                    <td>{formatDate(item.date)}</td>
                    <td>{eventLabel(item)}</td>
                    <td>{actor}</td>
                    <td>
                      {item.details}
                      {assignmentDelta}
                      {item.audit_action ? ` | action: ${item.audit_action}` : ""}
                    </td>
                    <td>{item.source}</td>
                  </tr>
                );
              })}
              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={5}>Aucun événement pour cet actif.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
