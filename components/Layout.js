import Sidebar from "./Sidebar";
import NotificationAlarm from "./NotificationAlarm";

export default function Layout({ children }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-content">
        <div className="app-topbar">
          <div className="app-topbar-spacer" />
          <NotificationAlarm />
        </div>
        <div className="app-page">
          {children}
        </div>
      </div>
    </div>
  );
}
