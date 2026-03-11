# Catalogue SQL Trio Asset Management

Date de mise a jour: 2026-03-10

Ce document classe tous les scripts SQL du depot.

Sources de verite:

- `sql/sql_manifest_2026-03-10.json`
- `docs/SQL_RUNBOOK_2026-03-10.md`

## 1. Chemin canonique from scratch

Le chemin canonique correspond a la liste `catalog.canonical` du manifeste.

| Ordre | Script | Role |
| --- | --- | --- |
| 1 | `sql/group_mode_roles_setup.sql` | Base roles metier |
| 2 | `sql/security_admin_audit_upgrade.sql` | Socle securite, admin, audit |
| 3 | `sql/feature_audit_assignment_history.sql` | Audit enrichi et historique d'attribution |
| 4 | `sql/assignment_update_ceo_daf_and_history_names.sql` | Gouvernance d'attribution avec noms libres |
| 5 | `sql/step_1_security_integrity_hardening.sql` | Durcissement droits et integrite |
| 6 | `sql/hotfix_asset_current_condition.sql` | Colonne `current_condition` requise par recherche et import |
| 7 | `sql/hotfix_2026_03_04_assets_search_and_user_labels.sql` | Recherche actifs et labels utilisateurs |
| 8 | `sql/step_2_secure_search_and_dashboard_rpc.sql` | RPC dashboard / recherche securisees |
| 9 | `sql/hotfix_dashboard_insurance_expiring_2w.sql` | Alerte assurance 14 jours |
| 10 | `sql/step_5_dashboard_amortization_chart.sql` | Serie amortissement dashboard |
| 11 | `sql/step_4_user_labels_email_patch.sql` | Patch labels utilisateur / email |
| 12 | `sql/feature_workflow_approvals.sql` | Workflows d'approbation lot 1 |
| 13 | `sql/feature_lot3_workflow_roles_and_asset_history.sql` | Alignement roles + historique diff champ a champ |
| 14 | `sql/feature_replacement_plan_simulation.sql` | Simulation remplacement CAPEX/OPEX/ROI |
| 15 | `sql/feature_company_rules_engine.sql` | Moteur de regles par societe |
| 16 | `sql/feature_data_health_actions.sql` | Sante des donnees actionnable |
| 17 | `sql/feature_app_notifications.sql` | Notifications applicatives |
| 18 | `sql/feature_email_notifications.sql` | Queue email transactionnelle, alertes incident et retry |
| 19 | `sql/hotfix_asset_vehicle_details.sql` | Colonne `vehicle_details` |
| 20 | `sql/hotfix_asset_code_autogenerate.sql` | Generation automatique des codes actif |
| 21 | `sql/feature_asset_bulk_import.sql` | Import massif CSV/XLSX avec dry-run |
| 22 | `sql/step_3_post_migration_checks.sql` | Controles finaux post-migration |

## 2. Scripts supersedes

Ces scripts restent versionnes pour historique ou rattrapage cible, mais ne doivent plus etre utilises dans un parcours from scratch.

| Script | Remplace par | Raison |
| --- | --- | --- |
| `sql/assets_assigned_to_name.sql` | `sql/assignment_update_ceo_daf_and_history_names.sql` | Le socle d'assignation enrichie ajoute deja `assigned_to_name` |
| `sql/assignment_allow_responsable_patch.sql` | `sql/assignment_update_ceo_daf_and_history_names.sql` | Le droit RESPONSABLE est deja inclus |
| `sql/feature_maintenance_rebus_workflows.sql` | `sql/feature_lot3_workflow_roles_and_asset_history.sql` | Le lot 3 reprend et etend ce workflow |
| `sql/fix_assignment_history_fk_trigger.sql` | `sql/feature_audit_assignment_history.sql`, `sql/assignment_update_ceo_daf_and_history_names.sql` | Le trigger AFTER est deja correct dans le chemin canonique |
| `sql/hotfix_asset_purchase_value_roles_and_audit.sql` | `sql/feature_workflow_approvals.sql`, `sql/feature_lot3_workflow_roles_and_asset_history.sql` | Les droits valeur d'achat sont maintenant gouvernes par workflow |
| `sql/predeploy_hardening.sql` | `sql/security_admin_audit_upgrade.sql`, `sql/feature_audit_assignment_history.sql`, `sql/step_1_security_integrity_hardening.sql`, `sql/hotfix_2026_03_04_assets_search_and_user_labels.sql` | Ses protections ont ete absorbees par le chemin canonique |

## 3. Patchs cibles

Ces scripts ne font pas partie du chemin standard. Ils servent uniquement a corriger un environnement existant identifie.

| Script | Quand l'utiliser |
| --- | --- |
| `sql/hotfix_admin_upsert_profile_ambiguous_id.sql` | Si un environnement possede encore l'ancienne version ambigue de `admin_upsert_profile` |

## 4. Regles d'exploitation

- Ne pas reconstruire l'ordre SQL a partir des conversations precedentes.
- Le manifeste `sql/sql_manifest_2026-03-10.json` fait foi pour la classification.
- Le runbook `docs/SQL_RUNBOOK_2026-03-10.md` fait foi pour l'ordre d'execution.
- Toute nouvelle migration SQL doit etre ajoutee au manifeste, puis documentee dans le runbook et ce catalogue.
- `sql/feature_email_notifications.sql` depend explicitement de:
  - `sql/feature_app_notifications.sql`
  - `sql/feature_audit_assignment_history.sql`
  - `sql/step_1_security_integrity_hardening.sql`
  - un scheduler HTTP externe si l'application est déployée sur Vercel Hobby
- `sql/feature_asset_bulk_import.sql` depend explicitement de:
  - `sql/assignment_update_ceo_daf_and_history_names.sql`
  - `sql/hotfix_asset_current_condition.sql`
  - `sql/hotfix_asset_vehicle_details.sql`
  - `sql/hotfix_asset_code_autogenerate.sql`
