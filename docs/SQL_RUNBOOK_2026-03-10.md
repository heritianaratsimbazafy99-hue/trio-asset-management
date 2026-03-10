# Runbook SQL Trio Asset Management

Date de mise à jour: 2026-03-10

Ce document définit l'ordre SQL de référence pour:

- une installation from scratch
- un rattrapage prod simplifié
- la vérification SQL du lot 6

## 1. From scratch

Exécuter les scripts dans cet ordre:

1. `sql/group_mode_roles_setup.sql`
2. `sql/security_admin_audit_upgrade.sql`
3. `sql/feature_audit_assignment_history.sql`
4. `sql/step_1_security_integrity_hardening.sql`
5. `sql/hotfix_2026_03_04_assets_search_and_user_labels.sql`
6. `sql/step_2_secure_search_and_dashboard_rpc.sql`
7. `sql/hotfix_dashboard_insurance_expiring_2w.sql`
8. `sql/step_5_dashboard_amortization_chart.sql`
9. `sql/step_4_user_labels_email_patch.sql`
10. `sql/feature_workflow_approvals.sql`
11. `sql/feature_lot3_workflow_roles_and_asset_history.sql`
12. `sql/feature_replacement_plan_simulation.sql`
13. `sql/feature_company_rules_engine.sql`
14. `sql/feature_data_health_actions.sql`
15. `sql/feature_app_notifications.sql`
16. `sql/step_3_post_migration_checks.sql`

## 2. Important sur les scripts supersédés

Le script suivant n'est plus dans le chemin standard from scratch:

- `sql/feature_maintenance_rebus_workflows.sql`

Raison:
- `sql/feature_lot3_workflow_roles_and_asset_history.sql` reprend et supersède la version initiale du lot 2 pour une base neuve.

Les scripts ci-dessous existent encore comme correctifs ciblés, mais ne font pas partie du chemin standard des 6 lots:

- `sql/assignment_allow_responsable_patch.sql`
- `sql/assignment_update_ceo_daf_and_history_names.sql`
- `sql/assets_assigned_to_name.sql`
- `sql/fix_assignment_history_fk_trigger.sql`
- `sql/hotfix_asset_code_autogenerate.sql`
- `sql/hotfix_asset_current_condition.sql`
- `sql/hotfix_asset_purchase_value_roles_and_audit.sql`
- `sql/hotfix_asset_vehicle_details.sql`
- `sql/hotfix_admin_upsert_profile_ambiguous_id.sql`

Ne les exécuter que si un besoin ciblé a été identifié sur l'environnement concerné.

## 3. Rattrapage prod simplifié

### Cas A - prod déjà alignée jusqu'au lot 5

Exécuter uniquement:

1. `sql/feature_data_health_actions.sql`
2. `sql/feature_app_notifications.sql`

### Cas B - prod a déjà reçu l'ancien lot 2

Exécuter dans cet ordre:

1. `sql/feature_lot3_workflow_roles_and_asset_history.sql`
2. `sql/feature_replacement_plan_simulation.sql`
3. `sql/feature_company_rules_engine.sql`
4. `sql/feature_data_health_actions.sql`
5. `sql/feature_app_notifications.sql`
6. `sql/step_3_post_migration_checks.sql`

### Cas C - prod a la base sécurité/dashboard mais pas les lots 1 à 6

Exécuter:

1. `sql/feature_workflow_approvals.sql`
2. `sql/feature_lot3_workflow_roles_and_asset_history.sql`
3. `sql/feature_replacement_plan_simulation.sql`
4. `sql/feature_company_rules_engine.sql`
5. `sql/feature_data_health_actions.sql`
6. `sql/feature_app_notifications.sql`
7. `sql/step_3_post_migration_checks.sql`

## 4. Vérification SQL du lot 6

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

Important:
- le SQL Editor n'exécute pas automatiquement un contexte applicatif authentifié
- il faut simuler l'utilisateur dans la meme exécution
- lancer tout le bloc ci-dessous d'un seul coup, dans le meme onglet

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

## 5. Vérification finale après migration

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
```

Puis vérifier côté application:

- dashboard
- notifications
- validations
- journal d'audit
- plan de remplacement
- règles
