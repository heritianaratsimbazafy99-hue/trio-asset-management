export default function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();

  // mapping -> classes couleurs
  const map = {
    EN_SERVICE: "en-service",
    HS: "hs",
    EN_MAINTENANCE: "maintenance",
    REBUS: "rebus",
    OUVERT: "ouvert",
    EN_COURS: "en-cours",
    EN_ATTENTE_VALIDATION: "pending",
  };

  const cls = map[s] || "";

  return <span className={`badge ${cls}`}>{s || "-"}</span>;
}
