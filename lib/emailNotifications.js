const DEFAULT_EMAIL_PROVIDER = "resend";

const REQUEST_TYPE_LABELS = {
  ASSET_DELETE: "suppression d'actif",
  ASSET_PURCHASE_VALUE_CHANGE: "changement de valeur d'achat",
  MAINTENANCE_START: "ticket maintenance",
  ASSET_REBUS: "passage en rebus",
};

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

function getWorkflowRequestTypeLabel(requestType) {
  const normalized = String(requestType || "").toUpperCase();
  return REQUEST_TYPE_LABELS[normalized] || "demande";
}

function normalizeNotificationPayload(queueItem) {
  const payload = queueItem?.payload || {};
  const notificationPayload =
    payload?.notification_payload && typeof payload.notification_payload === "object"
      ? payload.notification_payload
      : {};

  return {
    payload,
    notificationPayload,
    requestType: String(
      notificationPayload?.request_type || payload?.request_type || ""
    ).toUpperCase(),
    assetName: String(
      notificationPayload?.asset_name || payload?.asset_name || ""
    ).trim(),
    assetCode: String(
      notificationPayload?.asset_code || payload?.asset_code || ""
    ).trim(),
    companyName: String(
      notificationPayload?.company_name || payload?.company_name || ""
    ).trim(),
    reason: String(
      notificationPayload?.reason || payload?.reason || ""
    ).trim(),
    resolutionNote: String(
      notificationPayload?.resolution_note || payload?.resolution_note || ""
    ).trim(),
  };
}

function compactDetails(items) {
  return items.filter((item) => item && item.value);
}

function buildEmailScenario(queueItem, baseUrl) {
  const normalizedType = String(queueItem?.notification_type || "").toUpperCase();
  const { payload, notificationPayload, requestType, assetName, assetCode, companyName, reason, resolutionNote } =
    normalizeNotificationPayload(queueItem);
  const requestTypeLabel = getWorkflowRequestTypeLabel(requestType);
  const notificationTypeLabel = getNotificationEmailTypeLabel(normalizedType);
  const actionUrl = getAbsoluteUrl(baseUrl, payload?.link_path);
  const recipientLabel = String(payload?.recipient_label || "Bonjour");
  const fallbackTitle = String(payload?.title || queueItem?.subject || "Notification Trio Asset");
  const fallbackBody = String(
    payload?.body ||
      "Une notification necessitant votre attention a ete enregistree dans Trio Asset."
  );

  if (normalizedType === "INCIDENT_ALERT") {
    const incidentTitle = String(notificationPayload?.incident_title || "").trim();
    const incidentStatus = String(notificationPayload?.incident_status || "").trim();
    const description = String(notificationPayload?.incident_description || "").trim();
    return {
      subject: `Alerte incident${assetName ? ` - ${assetName}` : ""}`,
      title: incidentTitle || fallbackTitle,
      body:
        assetName
          ? `Un incident a ete declare sur l'actif ${assetName}.`
          : "Un incident necessitant votre attention a ete declare.",
      actionLabel: assetName ? "Ouvrir l'actif" : "Ouvrir l'incident",
      notificationTypeLabel,
      recipientLabel,
      actionUrl,
      accent: "#b45309",
      accentSoft: "rgba(245, 158, 11, 0.14)",
      details: compactDetails([
        { label: "Actif", value: assetName },
        { label: "Code actif", value: assetCode },
        { label: "Societe", value: companyName },
        { label: "Statut incident", value: incidentStatus },
        { label: "Objet", value: incidentTitle },
        { label: "Description", value: description },
      ]),
    };
  }

  if (normalizedType === "WORKFLOW_PENDING") {
    const ticketTitle = String(notificationPayload?.title || "").trim();
    return {
      subject: `Validation requise - ${requestTypeLabel}${assetName ? ` - ${assetName}` : ""}`,
      title: `Validation requise - ${requestTypeLabel}`,
      body: `Une demande de ${requestTypeLabel} attend votre decision.`,
      actionLabel: "Traiter la demande",
      notificationTypeLabel,
      recipientLabel,
      actionUrl,
      accent: "#d97706",
      accentSoft: "rgba(245, 158, 11, 0.14)",
      details: compactDetails([
        { label: "Actif", value: assetName },
        { label: "Societe", value: companyName },
        { label: "Motif", value: reason || fallbackBody },
        { label: "Objet", value: ticketTitle },
      ]),
    };
  }

  if (["WORKFLOW_APPROVED", "WORKFLOW_REJECTED", "WORKFLOW_FAILED"].includes(normalizedType)) {
    const statusCopy =
      normalizedType === "WORKFLOW_APPROVED"
        ? {
            subjectPrefix: "Demande approuvee",
            title: "Demande approuvee",
            body: `Votre demande de ${requestTypeLabel} a ete approuvee.`,
            accent: "#15803d",
            accentSoft: "rgba(21, 128, 61, 0.14)",
          }
        : normalizedType === "WORKFLOW_REJECTED"
          ? {
              subjectPrefix: "Demande rejetee",
              title: "Demande rejetee",
              body: `Votre demande de ${requestTypeLabel} a ete rejetee.`,
              accent: "#dc2626",
              accentSoft: "rgba(220, 38, 38, 0.14)",
            }
          : {
              subjectPrefix: "Demande en echec",
              title: "Demande en echec",
              body: `Votre demande de ${requestTypeLabel} a rencontre un probleme technique.`,
              accent: "#7f1d1d",
              accentSoft: "rgba(127, 29, 29, 0.14)",
            };

    return {
      subject: `${statusCopy.subjectPrefix} - ${requestTypeLabel}${assetName ? ` - ${assetName}` : ""}`,
      title: `${statusCopy.title} - ${requestTypeLabel}`,
      body: statusCopy.body,
      actionLabel: "Ouvrir dans Trio Asset",
      notificationTypeLabel,
      recipientLabel,
      actionUrl,
      accent: statusCopy.accent,
      accentSoft: statusCopy.accentSoft,
      details: compactDetails([
        { label: "Actif", value: assetName },
        { label: "Societe", value: companyName },
        { label: "Motif initial", value: reason },
        { label: "Note de resolution", value: resolutionNote || fallbackBody },
      ]),
    };
  }

  return {
    subject: String(queueItem?.subject || payload?.title || "Notification Trio Asset"),
    title: fallbackTitle,
    body: fallbackBody,
    actionLabel: "Ouvrir dans Trio Asset",
    notificationTypeLabel,
    recipientLabel,
    actionUrl,
    accent: "#0b3d91",
    accentSoft: "rgba(11, 61, 145, 0.14)",
    details: compactDetails([
      { label: "Actif", value: assetName },
      { label: "Societe", value: companyName },
    ]),
  };
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
  const scenario = buildEmailScenario(queueItem, baseUrl);
  const detailsHtml = scenario.details.length
    ? `
      <div style="margin:22px 0 0;padding:18px;border-radius:14px;background:${escapeHtml(scenario.accentSoft)};">
        ${scenario.details
          .map(
            (item) => `
            <div style="display:grid;grid-template-columns:160px 1fr;gap:10px;padding:8px 0;border-top:1px solid rgba(15, 23, 42, 0.08);">
              <strong style="font-size:13px;">${escapeHtml(item.label)}</strong>
              <span style="font-size:14px;line-height:1.5;">${escapeHtml(item.value)}</span>
            </div>
          `
          )
          .join("")}
      </div>
    `
    : "";

  const html = `
    <div style="background:#f6f3ee;padding:32px;font-family:Georgia,serif;color:#1e293b;">
      <div style="max-width:640px;margin:0 auto;background:#fffaf4;border:1px solid #eadfce;border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#153243,${escapeHtml(scenario.accent)});color:#fffaf4;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.88;">${escapeHtml(scenario.notificationTypeLabel)}</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${escapeHtml(scenario.title)}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Bonjour ${escapeHtml(scenario.recipientLabel)},</p>
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">${escapeHtml(scenario.body)}</p>
          ${detailsHtml}
          ${
            scenario.actionUrl
              ? `<p style="margin:24px 0;">
                  <a href="${escapeHtml(scenario.actionUrl)}" style="display:inline-block;padding:12px 18px;background:${escapeHtml(scenario.accent)};color:#fffaf4;text-decoration:none;border-radius:999px;font-weight:700;">
                    ${escapeHtml(scenario.actionLabel)}
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
    scenario.subject,
    "",
    `Type: ${scenario.notificationTypeLabel}`,
    `Bonjour ${scenario.recipientLabel},`,
    scenario.body,
    ...scenario.details.map((item) => `${item.label}: ${item.value}`),
    scenario.actionUrl ? `Lien: ${scenario.actionUrl}` : null,
    "",
    "Notification envoyee automatiquement par Trio Asset Management.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: scenario.subject,
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
