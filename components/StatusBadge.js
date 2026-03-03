export default function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();

  // mapping -> classes couleurs
  const map = {
    EN_SERVICE: "en-service",
    HS: "hs",
    EN_MAINTENANCE: "maintenance",
    OUVERT: "ouvert",
    EN_COURS: "en-cours",
  };

  const cls = map[s] || "";

  return <span className={`badge ${cls}`}>{s || "-"}</span>;
}