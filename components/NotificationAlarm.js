import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

function AlarmIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="notification-alarm-icon">
      <path
        d="M7.4 3.2 4.8 5.8m11.8-2.6 2.6 2.6M12 7a6 6 0 0 0-6 6v2.6l-1.5 2.2a.8.8 0 0 0 .7 1.2h13.6a.8.8 0 0 0 .7-1.2L18 15.6V13a6 6 0 0 0-6-6Zm0 14a2.4 2.4 0 0 0 2.3-1.7H9.7A2.4 2.4 0 0 0 12 21Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function NotificationAlarm() {
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;

    async function refreshUnreadCount() {
      const { data, error } = await supabase.rpc("get_unread_notifications_count");
      if (!alive || error) return;
      setCount(Number(data || 0));
    }

    refreshUnreadCount();
    const timer = window.setInterval(refreshUnreadCount, 60000);

    function handleRefresh() {
      refreshUnreadCount();
    }

    window.addEventListener("trio-sidebar-refresh", handleRefresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("trio-sidebar-refresh", handleRefresh);
    };
  }, [router.pathname]);

  return (
    <button
      type="button"
      className={`notification-alarm ${count > 0 ? "has-alert" : ""}`}
      onClick={() => router.push("/notifications")}
      aria-label={
        count > 0
          ? `${count} notification${count > 1 ? "s" : ""} non lue${count > 1 ? "s" : ""}`
          : "Ouvrir les notifications"
      }
    >
      <span className="notification-alarm-shell">
        <AlarmIcon />
        {count > 0 && <span className="notification-alarm-dot" />}
      </span>
      <span className="notification-alarm-copy">
        <strong>Alertes</strong>
        <small>{count > 0 ? `${count} non lue${count > 1 ? "s" : ""}` : "A jour"}</small>
      </span>
      {count > 0 && <span className="notification-alarm-count">{count}</span>}
    </button>
  );
}
