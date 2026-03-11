# Runbook d'exploitation email Trio Asset Management

Date de mise à jour: 2026-03-11

Ce document stabilise l'exploitation des lots 10 à 14:

- queue email transactionnelle
- dispatch serveur
- supervision email
- préférences avancées
- gouvernance des modèles et du routage

## 1. Variables serveur requises

Configurer en environnement serveur:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=...
APP_BASE_URL=https://<votre-domaine>
CRON_SECRET=...
```

Variables optionnelles:

```bash
EMAIL_REPLY_TO=...
EMAIL_PROVIDER=resend
EMAIL_NOTIFICATIONS_ENABLED=true
```

Rappels:

- `SUPABASE_SERVICE_ROLE_KEY` est requis par [supabaseAdmin.js](../lib/supabaseAdmin.js)
- `CRON_SECRET` est requis par [email-dispatch.js](../pages/api/notifications/email-dispatch.js)
- `APP_BASE_URL` est utilisé pour générer les liens absolus dans les emails

## 2. Scheduler externe

Le dispatch email est exposé par:

- `POST /api/notifications/email-dispatch`
- `GET /api/notifications/email-dispatch`

Authentification acceptée:

- header `Authorization: Bearer <CRON_SECRET>`
- ou header `x-cron-secret: <CRON_SECRET>`

Règle d'exploitation:

- sur Vercel Hobby, ne pas déclarer de `crons` dans `vercel.json`
- utiliser un scheduler HTTP externe
- cadence recommandée: toutes les 5 minutes en charge nominale

## 3. Déclenchement manuel

Exemple de test manuel:

```bash
curl -X POST "https://<votre-domaine>/api/notifications/email-dispatch?limit=20" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json"
```

Réponse attendue en succès:

```json
{
  "ok": true,
  "provider": "resend",
  "claimed": 1,
  "sent": 1,
  "failed": 0,
  "items": []
}
```

## 4. Vérification SQL

Dans SQL Editor, simuler un CEO ou un DAF dans le même bloc:

```sql
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '<CEO_OR_DAF_USER_UUID>', false);

select
  public.audit_actor_id() as actor_id,
  public.current_actor_role() as actor_role;

select *
from public.get_email_notification_metrics_secure();

select *
from public.list_email_notification_queue_secure('ALL', 'ALL', null, 20, 0);
```

Résultat attendu:

- `actor_role` vaut `CEO` ou `DAF`
- la vue supervision retourne des lignes sans erreur d'accès

## 5. Vérification UI

Vérifier côté application:

- `/notifications`
- `/notifications/operations`
- `/notifications/governance`

Contrôles attendus:

- le CEO et le DAF accèdent à `Supervision email`
- le CEO et le DAF accèdent à `Gouvernance des notifications`
- un rôle non leadership reçoit un écran d'accès refusé sur ces deux pages

## 6. Diagnostic rapide

- `401 Unauthorized`: le secret envoyé au endpoint ne correspond pas à `CRON_SECRET`
- `503 CRON_SECRET is not configured`: variable absente côté serveur
- `503 Email configuration missing: ...`: une variable email est absente
- lignes bloquées en `FAILED`: corriger la cause racine puis relancer depuis `Supervision email`
- lignes bloquées en `PROCESSING`: vérifier l'absence d'exécution concurrente orpheline et relancer si nécessaire

## 7. Reprise manuelle

Depuis l'UI `Supervision email`:

- action `Relancer` sur une ligne
- action `Relancer les échecs` sur le lot
- action `Annuler` si un envoi doit être neutralisé

Depuis SQL Editor avec simulation CEO ou DAF:

```sql
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '<CEO_OR_DAF_USER_UUID>', false);

select public.requeue_email_notification(<QUEUE_ID>);

select public.requeue_failed_email_notifications(50);
```
