import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/router";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../lib/accessControl";

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
  if (pathname === "/assets") return "assets";
  if (pathname === "/incidents") return "incidents";
  if (pathname === "/maintenance") return "maintenance";
  return null;
}

export default function Sidebar() {
  const router = useRouter();

  const [counts, setCounts] = useState({
    assets: 0,
    incidents: 0,
    maintenance: 0,
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

  async function fetchCounts(previousCounts, previousRole) {
    const fallbackCounts = {
      assets: previousCounts?.assets ?? 0,
      incidents: previousCounts?.incidents ?? 0,
      maintenance: previousCounts?.maintenance ?? 0,
    };
    const activeSection = getActiveSection(router.pathname);

    const [
      { count: assetCount },
      { count: incidentCount },
      { count: maintenanceCount },
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
      getCurrentUserProfile(),
    ]);

    const nextCounts = {
      assets: assetCount || 0,
      incidents: incidentCount || 0,
      maintenance: maintenanceCount || 0,
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
    return router.pathname.startsWith(path);
  }

  const canSeeAdmin = hasOneRole(userRole, [APP_ROLES.CEO]);
  const canSeeAudit = hasOneRole(userRole, [APP_ROLES.CEO, APP_ROLES.DAF]);

  const navItems = [
    { path: "/dashboard", label: "Dashboard", count: null },
    { path: "/assets", label: "Immobilisations", count: counts.assets },
    { path: "/incidents", label: "Incidents", count: counts.incidents },
    { path: "/maintenance", label: "Maintenance", count: counts.maintenance },
    ...(canSeeAudit ? [{ path: "/audit-logs", label: "Audit Logs", count: null }] : []),
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
