import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabaseClient";
import { getCurrentUserProfile } from "../../lib/accessControl";
import { fetchUserDirectoryMapByIds, getUserLabelById } from "../../lib/userDirectory";
import {
  getNotificationStatusClassName,
  getNotificationStatusLabel,
  getNotificationTypeLabel,
} from "../../lib/notifications";

const STATUS_FILTERS = ["UNREAD", "READ", "ALL"];

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function normalizeBody(value) {
  if (!value) return "-";
  return String(value);
}

function emitSidebarRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("trio-sidebar-refresh"));
}

export default function NotificationsPage() {
  const router = useRouter();

  const [notifications, setNotifications] = useState([]);
  const [actorsMap, setActorsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("UNREAD");
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    fetchNotifications();
  }, [statusFilter]);

  async function fetchNotifications() {
    setLoading(true);
    setError("");

    const { profile } = await getCurrentUserProfile();
    setUserRole(profile?.role || "");

    const { data, error: rpcError } = await supabase.rpc("list_notifications_secure", {
      p_status: statusFilter,
      p_limit: 100,
      p_offset: 0,
    });

    if (rpcError) {
      setError(rpcError.message);
      setNotifications([]);
      setActorsMap({});
      setLoading(false);
      return;
    }

    const rows = data || [];
    setNotifications(rows);

    const actorIds = Array.from(new Set(rows.map((item) => item.actor_user_id).filter(Boolean)));
    const nextActorsMap = await fetchUserDirectoryMapByIds(actorIds);
    setActorsMap(nextActorsMap);
    setLoading(false);
    emitSidebarRefresh();
  }

  async function markAsRead(notificationId) {
    setActionLoading(true);
    setError("");
    setMessage("");

    const { error: rpcError } = await supabase.rpc("mark_notification_read", {
      p_notification_id: notificationId,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage("Notification marquée comme lue.");
      await fetchNotifications();
    }

    setActionLoading(false);
  }

  async function markAllAsRead() {
    setActionLoading(true);
    setError("");
    setMessage("");

    const { data, error: rpcError } = await supabase.rpc("mark_all_notifications_read");

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMessage(`${Number(data || 0)} notification(s) marquée(s) comme lues.`);
      await fetchNotifications();
    }

    setActionLoading(false);
  }

  async function openNotification(item) {
    if (!item?.link_path) return;
    if (String(item.status || "").toUpperCase() === "UNREAD") {
      await markAsRead(item.id);
    }
    router.push(item.link_path);
  }

  return (
    <Layout>
      <h1>Notifications</h1>
      <p style={{ marginBottom: 12 }}>Rôle connecté: {userRole || "-"}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12 }}>
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_FILTERS.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "Toutes les notifications" : getNotificationStatusLabel(item)}
              </option>
            ))}
          </select>

          <button className="btn-secondary" onClick={() => fetchNotifications()}>
            Actualiser
          </button>

          <button className="btn-primary" disabled={actionLoading} onClick={() => markAllAsRead()}>
            Tout marquer comme lu
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-success">{message}</div>}

      <div className="card">
        {loading ? (
          <p>Chargement des notifications...</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Titre</th>
                  <th>Détail</th>
                  <th>Émis par</th>
                  <th>Statut</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.created_at)}</td>
                    <td>{getNotificationTypeLabel(item.notification_type)}</td>
                    <td>{item.title || "-"}</td>
                    <td>{normalizeBody(item.body)}</td>
                    <td>{getUserLabelById(actorsMap, item.actor_user_id)}</td>
                    <td>
                      <span className={getNotificationStatusClassName(item.status)}>
                        {getNotificationStatusLabel(item.status)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {String(item.status || "").toUpperCase() === "UNREAD" && (
                          <button
                            className="btn-secondary"
                            disabled={actionLoading}
                            onClick={() => markAsRead(item.id)}
                          >
                            Marquer comme lue
                          </button>
                        )}
                        {item.link_path && (
                          <button
                            className="btn-warning"
                            disabled={actionLoading}
                            onClick={() => openNotification(item)}
                          >
                            Ouvrir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {notifications.length === 0 && (
                  <tr>
                    <td colSpan={7}>Aucune notification pour ce filtre.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
