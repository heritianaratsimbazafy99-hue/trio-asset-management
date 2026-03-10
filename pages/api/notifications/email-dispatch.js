import { getEmailDispatchConfig, renderQueuedEmail, sendTransactionalEmail } from "../../../lib/emailNotifications";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

const DEFAULT_BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

function getRequestBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").trim();
  const host = forwardedHost || String(req.headers.host || "").trim();
  const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");

  if (!host) return "";
  return `${protocol}://${host}`;
}

function getAuthToken(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }
  return String(req.headers["x-cron-secret"] || "").trim();
}

function getBatchLimit(req) {
  const raw =
    req.method === "GET"
      ? req.query?.limit
      : req.body?.limit ?? req.query?.limit;
  const parsed = Number(raw || DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

async function auditEmailDispatch(admin, action, payload) {
  try {
    await admin.from("audit_logs").insert([
      {
        actor_user_id: null,
        action,
        entity_type: "email_notification_queue",
        entity_id: String(payload.queue_id || ""),
        payload,
      },
    ]);
  } catch {
    // Keep dispatch idempotent even if audit logging fails.
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return res.status(503).json({ error: "CRON_SECRET is not configured" });
  }

  if (getAuthToken(req) !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const config = getEmailDispatchConfig(getRequestBaseUrl(req));
  if (!config.enabled) {
    return res.status(503).json({
      error: config.disabledByFlag
        ? "Email notifications are disabled"
        : `Email configuration missing: ${config.missing.join(", ")}`,
    });
  }

  try {
    const admin = getSupabaseAdmin();
    const limit = getBatchLimit(req);

    const { data: queueItems, error: claimError } = await admin.rpc(
      "claim_email_notification_batch",
      { p_limit: limit }
    );

    if (claimError) {
      throw new Error(claimError.message);
    }

    const processedItems = [];
    let sent = 0;
    let failed = 0;

    for (const item of queueItems || []) {
      try {
        const rendered = renderQueuedEmail(item, { baseUrl: config.baseUrl });
        const providerResult = await sendTransactionalEmail({
          to: item.recipient_email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          config,
        });

        const { error: updateError } = await admin
          .from("email_notification_queue")
          .update({
            status: "SENT",
            sent_at: new Date().toISOString(),
            claimed_at: null,
            last_error: null,
            provider_message_id: providerResult.messageId,
            provider_response: providerResult.response,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        await auditEmailDispatch(admin, "EMAIL_NOTIFICATION_SENT", {
          queue_id: item.id,
          recipient_email: item.recipient_email,
          notification_type: item.notification_type,
          provider: providerResult.provider,
          provider_message_id: providerResult.messageId,
        });

        sent += 1;
        processedItems.push({
          id: item.id,
          status: "SENT",
          recipient_email: item.recipient_email,
          notification_type: item.notification_type,
        });
      } catch (error) {
        const message = String(error?.message || error || "Unknown email dispatch error");
        const nextAttemptAt =
          Number(item.attempt_count || 0) >= MAX_ATTEMPTS
            ? null
            : new Date(Date.now() + Math.min(60, Math.max(5, Number(item.attempt_count || 1) * 5)) * 60 * 1000).toISOString();

        await admin
          .from("email_notification_queue")
          .update({
            status: "FAILED",
            claimed_at: null,
            last_error: message.slice(0, 2000),
            next_attempt_at: nextAttemptAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        await auditEmailDispatch(admin, "EMAIL_NOTIFICATION_FAILED", {
          queue_id: item.id,
          recipient_email: item.recipient_email,
          notification_type: item.notification_type,
          error: message.slice(0, 500),
          attempt_count: item.attempt_count,
        });

        failed += 1;
        processedItems.push({
          id: item.id,
          status: "FAILED",
          recipient_email: item.recipient_email,
          notification_type: item.notification_type,
          error: message,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      provider: config.provider,
      claimed: Number(queueItems?.length || 0),
      sent,
      failed,
      items: processedItems,
    });
  } catch (error) {
    return res.status(500).json({
      error: String(error?.message || error || "Email dispatch failed"),
    });
  }
}
