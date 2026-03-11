import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import NotificationAlarm from "./NotificationAlarm";

const SIDEBAR_PREF_KEY = "trio_sidebar_behavior_v1";
const DESKTOP_QUERY = "(max-width: 980px)";
const AUTO_HIDE_DELAY_MS = 1600;

function readSidebarPreferences() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSidebarPreferences(payload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_PREF_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export default function Layout({ children }) {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarInteracting, setSidebarInteracting] = useState(false);
  const isDesktop = !isMobile;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const media = window.matchMedia(DESKTOP_QUERY);
    const cached = readSidebarPreferences();
    const pinned = cached?.sidebarPinned !== false;

    function applyViewport(nextIsMobile) {
      setIsMobile(nextIsMobile);
      setSidebarPinned(nextIsMobile ? true : pinned);
      setSidebarOpen(nextIsMobile ? false : true);
      setSidebarInteracting(false);
    }

    applyViewport(media.matches);

    function handleChange(event) {
      applyViewport(event.matches);
    }

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    writeSidebarPreferences({ sidebarPinned });
  }, [isMobile, sidebarPinned]);

  useEffect(() => {
    if (!isMobile) return;
    setSidebarOpen(false);
    setSidebarInteracting(false);
  }, [isMobile, router.pathname]);

  useEffect(() => {
    if (!isDesktop || isMobile || sidebarPinned || !sidebarOpen || sidebarInteracting) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSidebarOpen(false);
    }, AUTO_HIDE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isDesktop, isMobile, sidebarPinned, sidebarOpen, sidebarInteracting]);

  function handlePinToggle() {
    if (isMobile) {
      setSidebarOpen((previous) => !previous);
      return;
    }

    setSidebarPinned((previous) => {
      const nextPinned = !previous;
      setSidebarOpen(true);
      setSidebarInteracting(nextPinned);
      return nextPinned;
    });
  }

  function handleSidebarOpen() {
    setSidebarOpen(true);
  }

  function handleSidebarClose() {
    if (isMobile) {
      setSidebarOpen(false);
      return;
    }

    if (!sidebarPinned) {
      setSidebarOpen(false);
    }
  }

  return (
    <div
      className={`app-layout ${isMobile ? "is-mobile" : "is-desktop"} ${
        sidebarOpen ? "sidebar-open" : "sidebar-collapsed"
      } ${sidebarPinned ? "sidebar-pinned" : "sidebar-auto"}`}
    >
      {isDesktop && !sidebarOpen && (
        <button
          type="button"
          className="sidebar-edge-trigger"
          aria-label="Afficher le menu lateral"
          onMouseEnter={handleSidebarOpen}
          onFocus={handleSidebarOpen}
          onClick={handleSidebarOpen}
        >
          <span className="sidebar-edge-trigger__line" />
        </button>
      )}

      <Sidebar
        isMobile={isMobile}
        isDesktop={isDesktop}
        isOpen={sidebarOpen}
        isPinned={sidebarPinned}
        onOpen={handleSidebarOpen}
        onClose={handleSidebarClose}
        onPinToggle={handlePinToggle}
        onInteractionStart={() => {
          setSidebarInteracting(true);
          setSidebarOpen(true);
        }}
        onInteractionEnd={() => {
          setSidebarInteracting(false);
        }}
      />

      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Fermer le menu lateral"
          onClick={handleSidebarClose}
        />
      )}

      <div className="app-content">
        <div className="app-topbar">
          <div className="app-topbar-spacer" />
          <div className="app-topbar-actions">
            <button
              type="button"
              className="sidebar-topbar-toggle"
              aria-label={
                isMobile
                  ? sidebarOpen
                    ? "Fermer le menu lateral"
                    : "Ouvrir le menu lateral"
                  : sidebarPinned
                  ? "Desepingler le menu lateral"
                  : "Epingler le menu lateral"
              }
              aria-pressed={isMobile ? sidebarOpen : sidebarPinned}
              onClick={handlePinToggle}
            >
              <span />
              <span />
              <span />
            </button>
            <NotificationAlarm />
          </div>
        </div>
        <div className="app-page">{children}</div>
      </div>
    </div>
  );
}
