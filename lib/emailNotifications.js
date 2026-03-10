const DEFAULT_EMAIL_PROVIDER = "resend";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getAbsoluteUrl(baseUrl, linkPath) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedLinkPath = String(linkPath || "").trim();

  if (!normalizedLinkPath) return "";
  if (/^https?:\/\//i.test(normalizedLinkPath)) return normalizedLinkPath;
  if (!normalizedBaseUrl) return normalizedLinkPath;
  if (normalizedLinkPath.startsWith("/")) {
    return `${normalizedBaseUrl}${normalizedLinkPath}`;
  }
  return `${normalizedBaseUrl}/${normalizedLinkPath}`;
}

function getNotificationEmailTypeLabel(notificationType) {
  const normalized = String(notificationType || "").toUpperCase();
  if (normalized === "WORKFLOW_PENDING") return "Validation requise";
  if (normalized === "WORKFLOW_APPROVED") return "Demande approuvée";
  if (normalized === "WORKFLOW_REJECTED") return "Demande rejetée";
  if (normalized === "WORKFLOW_FAILED") return "Demande en echec";
  if (normalized === "INCIDENT_ALERT") return "Alerte incident";
  return normalized || "Notification";
}

export function getEmailDispatchConfig(baseUrlFallback = "") {
  const enabledFlag = String(process.env.EMAIL_NOTIFICATIONS_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  const provider = String(process.env.EMAIL_PROVIDER || DEFAULT_EMAIL_PROVIDER)
    .trim()
    .toLowerCase();
  const from = String(process.env.EMAIL_FROM || "").trim();
  const replyTo = String(process.env.EMAIL_REPLY_TO || "").trim();
  const baseUrl =
    String(process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "") ||
    String(baseUrlFallback || "").trim().replace(/\/+$/, "");
  const missing = [];

  if (!from) {
    missing.push("EMAIL_FROM");
  }

  if (!baseUrl) {
    missing.push("APP_BASE_URL");
  }

  if (provider === "resend" && !String(process.env.RESEND_API_KEY || "").trim()) {
    missing.push("RESEND_API_KEY");
  }

  return {
    enabled: enabledFlag !== "false" && missing.length === 0,
    disabledByFlag: enabledFlag === "false",
    missing,
    provider,
    from,
    replyTo: replyTo || null,
    baseUrl,
    resendApiKey: String(process.env.RESEND_API_KEY || "").trim(),
  };
}

export function renderQueuedEmail(queueItem, { baseUrl }) {
  const payload = queueItem?.payload || {};
  const subject = String(queueItem?.subject || payload?.title || "Notification Trio Asset");
  const title = String(payload?.title || subject);
  const body = String(
    payload?.body ||
      "Une notification necessitant votre attention a ete enregistree dans Trio Asset."
  );
  const notificationTypeLabel = getNotificationEmailTypeLabel(queueItem?.notification_type);
  const recipientLabel = String(payload?.recipient_label || "Bonjour");
  const actionUrl = getAbsoluteUrl(baseUrl, payload?.link_path);
  const actionLabel =
    String(queueItem?.notification_type || "").toUpperCase() === "INCIDENT_ALERT"
      ? "Ouvrir l'incident"
      : "Ouvrir dans Trio Asset";

  const html = `
    <div style="background:#f6f3ee;padding:32px;font-family:Georgia,serif;color:#1e293b;">
      <div style="max-width:640px;margin:0 auto;background:#fffaf4;border:1px solid #eadfce;border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#153243,#284b63);color:#fffaf4;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.88;">${escapeHtml(notificationTypeLabel)}</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Bonjour ${escapeHtml(recipientLabel)},</p>
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">${escapeHtml(body)}</p>
          ${
            actionUrl
              ? `<p style="margin:24px 0;">
                  <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#d97706;color:#fffaf4;text-decoration:none;border-radius:999px;font-weight:700;">
                    ${escapeHtml(actionLabel)}
                  </a>
                </p>`
              : ""
          }
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5f6f83;">
            Notification envoyee automatiquement par Trio Asset Management.
          </p>
        </div>
      </div>
    </div>
  `;

  const text = [
    title,
    "",
    `Type: ${notificationTypeLabel}`,
    `Bonjour ${recipientLabel},`,
    body,
    actionUrl ? `Lien: ${actionUrl}` : null,
    "",
    "Notification envoyee automatiquement par Trio Asset Management.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject,
    html,
    text,
  };
}

export async function sendTransactionalEmail({ to, subject, html, text, config }) {
  const recipient = String(to || "").trim();
  if (!recipient) {
    throw new Error("Recipient email missing");
  }

  if (config.provider !== "resend") {
    throw new Error(`Unsupported email provider: ${config.provider}`);
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [recipient],
      subject,
      html,
      text,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    }),
  });

  const raw = await response.text();
  let parsed = {};

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    throw new Error(parsed?.message || parsed?.error || `Email provider error (${response.status})`);
  }

  return {
    provider: config.provider,
    messageId: parsed?.id || null,
    response: parsed,
  };
}
