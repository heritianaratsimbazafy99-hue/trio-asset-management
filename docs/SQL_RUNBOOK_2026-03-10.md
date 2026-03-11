# Runbook SQL Trio Asset Management

Date de mise à jour: 2026-03-11

Ce document définit l'ordre SQL de référence pour:

- une installation from scratch
- un rattrapage prod simplifié
- la vérification SQL des fonctions sécurisées

Sources de vérité:

- `sql/sql_manifest_2026-03-10.json`
- `docs/SQL_CATALOG_2026-03-10.md`

## 1. From scratch

Exécuter les scripts dans cet ordre:

1. `sql/group_mode_roles_setup.sql`
2. `sql/security_admin_audit_upgrade.sql`
3. `sql/feature_audit_assignment_history.sql`
4. `sql/assignment_update_ceo_daf_and_history_names.sql`
5. `sql/step_1_security_integrity_hardening.sql`
6. `sql/hotfix_asset_current_condition.sql`
7. `sql/hotfix_2026_03_04_assets_search_and_user_labels.sql`
8. `sql/step_2_secure_search_and_dashboard_rpc.sql`
9. `sql/hotfix_dashboard_insurance_expiring_2w.sql`
10. `sql/step_5_dashboard_amortization_chart.sql`
11. `sql/step_4_user_labels_email_patch.sql`
12. `sql/feature_workflow_approvals.sql`
13. `sql/feature_lot3_workflow_roles_and_asset_history.sql`
14. `sql/feature_replacement_plan_simulation.sql`
15. `sql/feature_company_rules_engine.sql`
16. `sql/feature_data_health_actions.sql`
17. `sql/feature_app_notifications.sql`
18. `sql/feature_email_notifications.sql`
19. `sql/feature_notification_preferences.sql`
20. `sql/feature_notification_advanced_preferences.sql`
21. `sql/feature_notification_governance.sql`
22. `sql/feature_notification_operations.sql`
23. `sql/hotfix_asset_vehicle_details.sql`
24. `sql/hotfix_asset_code_autogenerate.sql`
25. `sql/feature_asset_bulk_import.sql`
26. `sql/step_3_post_migration_checks.sql`

Pourquoi ces ajouts sont canoniques:

- `sql/assignment_update_ceo_daf_and_history_names.sql` rend l'assignation libre cohérente avec l'état actuel de l'application et avec `sql/feature_asset_bulk_import.sql`.
- `sql/hotfix_asset_current_condition.sql` doit passer avant `sql/hotfix_2026_03_04_assets_search_and_user_labels.sql`, car la recherche sécurisée utilise déjà `current_condition`.
- `sql/feature_email_notifications.sql` ajoute la queue email, le dispatch transactionnel et les alertes incident au-dessus des notifications applicatives existantes.
- `sql/feature_notification_preferences.sql` ajoute les préférences utilisateur app/email, le filtrage des notifications visibles et le filtrage de la queue email.
- `sql/feature_notification_advanced_preferences.sql` ajoute les préférences fines par sous-type de workflow et les filtres app/email avancés.
- `sql/feature_notification_governance.sql` ajoute les modèles et règles de routage administrables, avec fallback métier si aucune surcharge n'est active.
- `sql/feature_notification_operations.sql` ajoute la supervision d'exploitation, les métriques et les actions de reprise manuelle sur la queue email.
- `sql/hotfix_asset_vehicle_details.sql` et `sql/hotfix_asset_code_autogenerate.sql` sont nécessaires avant `sql/feature_asset_bulk_import.sql`.

## 2. Scripts supersédés ou ciblés

Le détail complet est maintenu dans `docs/SQL_CATALOG_2026-03-10.md`.

Script supersédé principal:

- `sql/feature_maintenance_rebus_workflows.sql`

Raison:
- `sql/feature_lot3_workflow_roles_and_asset_history.sql` reprend et supersède la version initiale du lot 2 pour une base neuve.

Patch ciblé hors chemin standard:

- `sql/hotfix_admin_upsert_profile_ambiguous_id.sql`

Autres scripts historiques classés comme supersédés dans le catalogue:

- `sql/assets_assigned_to_name.sql`
- `sql/assignment_allow_responsable_patch.sql`
- `sql/fix_assignment_history_fk_trigger.sql`
- `sql/hotfix_asset_purchase_value_roles_and_audit.sql`
- `sql/predeploy_hardening.sql`

Ne pas les utiliser pour une base neuve. Suivre le manifeste et le catalogue.

## 3. Rattrapage prod simplifié

Hypothèse:

- si l'état réel de prod est incertain, reprendre le chemin from scratch du manifeste
- les scénarios ci-dessous servent uniquement à raccourcir un rattrapage connu

### Cas A - prod déjà alignée jusqu'au lot 8

Exécuter uniquement:

1. `sql/feature_email_notifications.sql`
2. `sql/feature_notification_preferences.sql`
3. `sql/feature_notification_advanced_preferences.sql`
4. `sql/feature_notification_governance.sql`
5. `sql/feature_notification_operations.sql`
6. `sql/step_3_post_migration_checks.sql`

### Cas A bis - prod déjà alignée jusqu'au lot 13

Exécuter uniquement:

1. `sql/feature_notification_governance.sql`
2. `sql/step_3_post_migration_checks.sql`

### Cas B - prod déjà alignée jusqu'au lot 5

Exécuter uniquement:

1. `sql/feature_data_health_actions.sql`
2. `sql/feature_app_notifications.sql`
3. `sql/feature_email_notifications.sql`
4. `sql/feature_notification_preferences.sql`
5. `sql/feature_notification_advanced_preferences.sql`
6. `sql/feature_notification_governance.sql`
7. `sql/feature_notification_operations.sql`
8. `sql/hotfix_asset_current_condition.sql`
9. `sql/hotfix_asset_vehicle_details.sql`
10. `sql/hotfix_asset_code_autogenerate.sql`
11. `sql/feature_asset_bulk_import.sql`
12. `sql/step_3_post_migration_checks.sql`

### Cas C - prod a déjà reçu l'ancien lot 2

Exécuter dans cet ordre:

1. `sql/feature_lot3_workflow_roles_and_asset_history.sql`
2. `sql/feature_replacement_plan_simulation.sql`
3. `sql/feature_company_rules_engine.sql`
4. `sql/feature_data_health_actions.sql`
5. `sql/feature_app_notifications.sql`
6. `sql/feature_email_notifications.sql`
7. `sql/feature_notification_preferences.sql`
8. `sql/feature_notification_advanced_preferences.sql`
9. `sql/feature_notification_governance.sql`
10. `sql/feature_notification_operations.sql`
11. `sql/hotfix_asset_current_condition.sql`
12. `sql/hotfix_asset_vehicle_details.sql`
13. `sql/hotfix_asset_code_autogenerate.sql`
14. `sql/feature_asset_bulk_import.sql`
15. `sql/step_3_post_migration_checks.sql`

### Cas D - prod a la base sécurité/dashboard mais pas les lots fonctionnels

Exécuter:

1. `sql/feature_audit_assignment_history.sql`
2. `sql/assignment_update_ceo_daf_and_history_names.sql`
3. `sql/feature_workflow_approvals.sql`
4. `sql/feature_lot3_workflow_roles_and_asset_history.sql`
5. `sql/feature_replacement_plan_simulation.sql`
6. `sql/feature_company_rules_engine.sql`
7. `sql/feature_data_health_actions.sql`
8. `sql/feature_app_notifications.sql`
9. `sql/feature_email_notifications.sql`
10. `sql/feature_notification_preferences.sql`
11. `sql/feature_notification_advanced_preferences.sql`
12. `sql/feature_notification_governance.sql`
13. `sql/feature_notification_operations.sql`
14. `sql/hotfix_asset_current_condition.sql`
15. `sql/hotfix_asset_vehicle_details.sql`
16. `sql/hotfix_asset_code_autogenerate.sql`
17. `sql/feature_asset_bulk_import.sql`
18. `sql/step_3_post_migration_checks.sql`

## 4. Tester une fonction sécurisée dans SQL Editor

Important:

- le SQL Editor n'injecte pas automatiquement `auth.uid()`
- toute fonction qui dépend de `auth.uid()` ou de `public.audit_actor_id()` doit être testée dans le même bloc SQL que la simulation d'utilisateur
- lancer tout le bloc dans le même onglet, en une seule exécution

Gabarit générique:

```sql
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '<USER_UUID>', false);

select
  public.audit_actor_id() as actor_id,
  public.current_actor_role() as actor_role;
```

## 5. Vérification SQL du lot 6

### Vérification structurelle

```sql
select proname
from pg_proc
where proname in (
  'current_actor_role',
  'list_data_health_issues_secure',
  'fix_data_health_asset_purchase_value',
  'fix_data_health_asset_company',
  'fix_data_health_asset_amortization',
  'fix_data_health_maintenance_deadline',
  'fix_data_health_incident_title'
)
order by proname;
```

### Vérification fonctionnelle dans SQL Editor

```sql
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '<CEO_USER_UUID>', false);

select
  public.audit_actor_id() as actor_id,
  public.current_actor_role() as actor_role;

select *
from public.list_data_health_issues_secure('MISSING_VALUE', null, null, '12M', 20, 0);

select *
from public.list_data_health_issues_secure('MISSING_COMPANY', null, null, '12M', 20, 0);

select *
from public.list_data_health_issues_secure('MISSING_AMORTIZATION', null, null, '12M', 20, 0);

select *
from public.list_data_health_issues_secure('MAINTENANCE_MISSING_DEADLINE', null, null, '12M', 20, 0);

select *
from public.list_data_health_issues_secure('INCIDENT_MISSING_TITLE', null, null, '12M', 20, 0);
```

Résultat attendu:

- `actor_id` doit retourner l'UUID injecté
- `actor_role` doit retourner un rôle métier valide, par exemple `CEO`

## 6. Vérification finale après migration

Exécuter:

```sql
select *
from public.get_user_labels(null)
limit 20;

select *
from public.list_workflow_requests_secure('PENDING', 20, 0);

select *
from public.list_data_health_issues_secure('ALL', null, null, '12M', 20, 0);

select public.get_unread_notifications_count();

select *
from public.list_notifications_secure('ALL', 20, 0);

select *
from public.email_notification_queue
order by created_at desc
limit 20;

select *
from public.bulk_import_assets(
  jsonb_build_array(
    jsonb_build_object(
      'name', 'Test import dry-run',
      'category', 'IT_ORDINATEURS',
      'company_name', 'Mobix',
      'purchase_value', '1200000',
      'status', 'EN_SERVICE',
      'current_condition', 'BON',
      'amortissement_type', 'LINEAIRE',
      'amortissement_duration', '5'
    )
  ),
  true
);
```

Pour tester le dispatch email via l'application serveur:

- configurer `SUPABASE_SERVICE_ROLE_KEY`
- configurer `RESEND_API_KEY`
- configurer `EMAIL_FROM`
- configurer `APP_BASE_URL`
- configurer `CRON_SECRET`
- configurer un scheduler externe qui appelle `/api/notifications/email-dispatch`
- sur Vercel Hobby, ne pas declarer de `crons` dans `vercel.json`

Pour l'exploitation courante et le smoke test post-deploiement des lots 10 a 14, utiliser aussi:

- `docs/EMAIL_OPERATIONS_RUNBOOK_2026-03-11.md`
- `docs/POST_DEPLOY_SMOKE_TEST_2026-03-11.md`

Puis vérifier côté application:

- dashboard
- notifications
- validations
- journal d'audit
- import massif d'actifs
- plan de remplacement
- règles
