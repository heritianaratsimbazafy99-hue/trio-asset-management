import Sidebar from "./Sidebar";

export default function Layout({ children }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-content">
        {children}
      </div>
    </div>
  );
}
