// components/Timeline.js

export default function Timeline({ items }) {
  if (!items || items.length === 0) {
    return (
      <div className="card">
        <h3>Historique</h3>
        <p>Aucun historique pour cet actif.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Historique</h3>
      <div className="timeline">
        {items.map((item) => (
          <div key={item.id} className="timeline-item">
            <div className="timeline-date">
              {new Date(item.created_at).toLocaleDateString()}
            </div>
            <div className="timeline-content">
              <span>
                {item.type === "incident" ? "Incident" : "Maintenance"} - {item.title}
                {item.status ? ` (${item.status})` : ""}
              </span>
              {(item.reportedBy || item.closedBy || item.closedAt) && (
                <div style={{ marginTop: 4, color: "#5f6f83", fontWeight: 500, fontSize: 13 }}>
                  {item.reportedBy ? `Signalé par: ${item.reportedBy}` : ""}
                  {item.closedBy ? ` | Clôturé par: ${item.closedBy}` : ""}
                  {item.closedAt ? ` | Date clôture: ${new Date(item.closedAt).toLocaleDateString("fr-FR")}` : ""}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
