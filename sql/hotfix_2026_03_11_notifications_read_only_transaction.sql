-- Hotfix - Notifications RPC read-only transaction
-- Date: 2026-03-11
--
-- Run on an existing environment if /notifications shows:
-- "cannot execute INSERT in a read-only transaction"
--
-- Cause:
-- The active RPCs list_notifications_secure() and get_unread_notifications_count()
-- were marked STABLE while they can initialize/complete notification preferences
-- through ensure_user_notification_preferences(_advanced), which may write rows.

alter function public.list_notifications_secure(text, integer, integer) volatile;
alter function public.get_unread_notifications_count() volatile;

notify pgrst, 'reload schema';
