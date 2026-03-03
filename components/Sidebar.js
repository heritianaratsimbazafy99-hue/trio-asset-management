import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/router";
import { APP_ROLES, getCurrentUserProfile, hasOneRole } from "../lib/accessControl";

export default function Sidebar() {
  const router = useRouter();

  const [counts, setCounts] = useState({
    assets: 0,
    incidents: 0,
    maintenance: 0,
  });
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    fetchCounts();
  }, []);

  async function fetchCounts() {
    const [
      { count: assetCount },
      { count: incidentCount },
      { count: maintenanceCount },
      { profile },
    ] = await Promise.all([
      supabase.from("assets").select("*", { count: "exact", head: true }),
      supabase.from("incidents").select("*", { count: "exact", head: true }),
      supabase.from("maintenance").select("*", { count: "exact", head: true }),
      getCurrentUserProfile(),
    ]);

    setCounts({
      assets: assetCount || 0,
      incidents: incidentCount || 0,
      maintenance: maintenanceCount || 0,
    });
    setUserRole(profile?.role || "");
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
            onClick={() => router.push(item.path)}
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
