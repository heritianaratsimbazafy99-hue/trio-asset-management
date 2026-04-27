const SIDEBAR_REFRESH_EVENT = "trio-sidebar-refresh";
const NOTIFICATIONS_REFRESH_EVENT = "trio-notifications-refresh";

function dispatchRefreshEvent(eventName, detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function emitNotificationRefresh(reason = "manual") {
  const detail = {
    reason,
    at: new Date().toISOString(),
  };

  dispatchRefreshEvent(SIDEBAR_REFRESH_EVENT, detail);
  dispatchRefreshEvent(NOTIFICATIONS_REFRESH_EVENT, detail);
}

export function emitSidebarNotificationRefresh(reason = "manual") {
  const detail = {
    reason,
    at: new Date().toISOString(),
  };

  dispatchRefreshEvent(SIDEBAR_REFRESH_EVENT, detail);
}

export function getNotificationRefreshEventNames() {
  return {
    sidebar: SIDEBAR_REFRESH_EVENT,
    notifications: NOTIFICATIONS_REFRESH_EVENT,
  };
}
