import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/router";
import {
  APP_ROLES,
  getCurrentUserProfile,
  hasOneRole,
} from "../lib/accessControl";

const SIDEBAR_CACHE_KEY = "trio_sidebar_counts_v1";

function readSidebarCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SIDEBAR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSidebarCache(payload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SIDEBAR_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function getActiveSection(pathname = "") {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/assets") return "assets";
  if (pathname === "/incidents") return "incidents";
  if (pathname === "/maintenance") return "maintenance";
  if (pathname === "/notifications") return "notifications";
  if (pathname === "/notifications/governance") return "notification-governance";
  if (pathname === "/notifications/operations") return "notification-operations";
  if (pathname === "/replacement-plan") return "replacement-plan";
  if (pathname === "/rules") return "rules";
  if (pathname === "/approvals") return "approvals";
  if (pathname === "/audit-logs") return "audit-logs";
  if (pathname === "/admin/users") return "admin-users";
  return null;
}

export default function Sidebar() {
  const router = useRouter();

  const [counts, setCounts] = useState({
    assets: 0,
    incidents: 0,
    maintenance: 0,
    notifications: 0,
  });
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    const cached = readSidebarCache();
    if (cached?.counts) {
      setCounts(cached.counts);
    }
    if (cached?.userRole) {
      setUserRole(cached.userRole);
    }
    fetchCounts(cached?.counts, cached?.userRole);
  }, [router.pathname]);

  useEffect(() => {
    function handleRefresh() {
      const cached = readSidebarCache();
      fetchCounts(cached?.counts, cached?.userRole);
    }

    window.addEventListener("trio-sidebar-refresh", handleRefresh);
    return () => window.removeEventListener("trio-sidebar-refresh", handleRefresh);
  }, [router.pathname]);

  async function fetchCounts(previousCounts, previousRole) {
    const fallbackCounts = {
      assets: previousCounts?.assets ?? 0,
      incidents: previousCounts?.incidents ?? 0,
      maintenance: previousCounts?.maintenance ?? 0,
      notifications: previousCounts?.notifications ?? 0,
    };
    const activeSection = getActiveSection(router.pathname);

    const [
      { count: assetCount },
      { count: incidentCount },
      { count: maintenanceCount },
      notificationsResponse,
      { profile },
    ] = await Promise.all([
      activeSection === "assets"
        ? Promise.resolve({ count: fallbackCounts.assets })
        : supabase.from("assets").select("id", { count: "exact", head: true }),
      activeSection === "incidents"
        ? Promise.resolve({ count: fallbackCounts.incidents })
        : supabase.from("incidents").select("id", { count: "exact", head: true }),
      activeSection === "maintenance"
        ? Promise.resolve({ count: fallbackCounts.maintenance })
        : supabase.from("maintenance").select("id", { count: "exact", head: true }),
      activeSection === "notifications"
        ? Promise.resolve({ data: fallbackCounts.notifications })
        : supabase.rpc("get_unread_notifications_count"),
      getCurrentUserProfile(),
    ]);

    const nextCounts = {
      assets: assetCount || 0,
      incidents: incidentCount || 0,
      maintenance: maintenanceCount || 0,
      notifications: Number(notificationsResponse?.data || 0),
    };
    const nextRole = profile?.role || previousRole || "";

    setCounts(nextCounts);
    setUserRole(nextRole);
    writeSidebarCache({
      counts: nextCounts,
      userRole: nextRole,
      updatedAt: new Date().toISOString(),
    });
  }

  function isActive(path) {
    const currentSection = getActiveSection(router.pathname);
    const targetSection = getActiveSection(path);
    if (currentSection && targetSection) {
      return currentSection === targetSection;
    }
    return router.pathname === path || router.pathname.startsWith(`${path}/`);
  }

  const canSeeAdmin = hasOneRole(userRole, [APP_ROLES.CEO]);
  const canSeeAudit = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);
  const canSeeNotificationOperations = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);
  const canSeeNotificationGovernance = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);
  const canSeeApprovals = true;

  const navItems = [
    { path: "/dashboard", label: "Dashboard", count: null },
    { path: "/notifications", label: "Notifications", count: counts.notifications },
    { path: "/assets", label: "Immobilisations", count: counts.assets },
    { path: "/incidents", label: "Incidents", count: counts.incidents },
    { path: "/maintenance", label: "Maintenance", count: counts.maintenance },
    ...(canSeeApprovals ? [{ path: "/approvals", label: "Validations", count: null }] : []),
    ...(canSeeNotificationOperations
      ? [{ path: "/notifications/operations", label: "Supervision email", count: null }]
      : []),
    { path: "/replacement-plan", label: "Remplacement", count: null },
    ...(canSeeNotificationGovernance
      ? [{ path: "/notifications/governance", label: "Gouvernance notif", count: null }]
      : []),
    ...(canSeeAdmin ? [{ path: "/rules", label: "Règles", count: null }] : []),
    ...(canSeeAudit ? [{ path: "/audit-logs", label: "Journal d'audit", count: null }] : []),
    ...(canSeeAdmin ? [{ path: "/admin/users", label: "Administration", count: null }] : []),
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <img src="/trio-logo.svg" alt="Groupe Trio" className="sidebar-logo" />
        <div>
          <h2>Trio Asset</h2>
          <p>Gestion centralisee</p>
        </div>
      </div>

      <div className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.path}
            className={`sidebar-link ${isActive(item.path) ? "active" : ""}`}
            onClick={() => {
              if (isActive(item.path)) return;
              router.push(item.path);
            }}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span className="sidebar-count">{item.count}</span>
            )}
          </button>
        ))}
      </div>

      <button className="sidebar-logout" onClick={() => router.push("/logout")}>
        Deconnexion
      </button>
    </div>
  );
}
