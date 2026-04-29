# Contexte de reprise Trio Asset Management

Date de mise à jour: 2026-04-29

## Etat fonctionnel couvert

Les lots 1 à 14 sont implémentés côté code ou documentation d'exploitation:

1. Workflow d'approbation pour suppression d'actif et changement de valeur d'achat
2. Ticket maintenance avec validation avant démarrage et demande de passage en rebus
3. Alignement des rôles sensibles + historique complet des modifications d'actif avec diff champ par champ
4. Plan de remplacement avec simulation CAPEX / OPEX / ROI
5. Moteur de règles configurable par société sans code
6. Santé des données actionnable depuis le dashboard avec corrections directes
7. Notifications applicatives pour les workflows avec centre de notifications dans l'application
8. Import massif Excel / CSV avec dry-run de validation avant écriture
9. Consolidation technique SQL avec manifeste canonique, catalogue de scripts et runbook unique
10. Notifications email transactionnelles avec queue, dispatch serveur et alerte incident
11. Préférences notifications app/email par utilisateur avec alarme globale des non lus
12. Supervision opérationnelle des emails avec métriques, filtres et actions de reprise
13. Templates email métier et préférences avancées par sous-type de workflow
14. Gouvernance administrable des modèles et règles de diffusion des notifications

## Règles métier en vigueur

- Tout utilisateur connecté peut demander:
  - la suppression d'un actif
  - le changement de valeur d'achat
- Seul le CEO peut appliquer directement:
  - la suppression d'un actif
  - le changement de valeur d'achat
- Les demandes de suppression d'actif et de changement de valeur d'achat sont validées par le CEO
- Les tickets maintenance en attente suivent deux etapes sequentielles:
  - le DAF valide ou refuse la conformite du ticket
  - le CEO donne ou refuse ensuite l'accord pour demarrer la maintenance
- Quand une maintenance est cloturee, le statut de l'actif lie est recalcule automatiquement:
  - `EN_SERVICE` si aucun incident ouvert ni maintenance active ne reste
  - `EN_MAINTENANCE` si un incident ouvert ou une autre maintenance active existe encore
  - `REBUS` est conserve
- Le signalement d'un actif irréparable peut être initié par CEO ou RESPONSABLE_MAINTENANCE
- Les corrections de santé des données respectent les rôles suivants:
  - valeur d'achat manquante: CEO uniquement
  - société manquante / amortissement incomplet: CEO, DAF, RESPONSABLE
  - deadline maintenance / titre incident: CEO, DAF, RESPONSABLE, RESPONSABLE_MAINTENANCE

## Stabilisation déjà engagée

- Le lot 6 est documenté avec une contrainte claire: les tests SQL qui dépendent de `auth.uid()` ou de `audit_actor_id()` doivent simuler un utilisateur authentifié dans la meme exécution SQL Editor.
- Les libellés UI visibles sont réalignés sur le métier:
  - `Approvals` devient `Validations`
  - `Audit Logs` devient `Journal d'audit`
  - les libellés workflow exposent `valeur d'achat` au lieu de `valeur comptable`
- Un runbook SQL unique est maintenu dans `docs/SQL_RUNBOOK_2026-03-10.md`
- Un manifeste SQL versionné et un catalogue de scripts sont maintenus dans:
  - `sql/sql_manifest_2026-03-10.json`
  - `docs/SQL_CATALOG_2026-03-10.md`
- Le `README.md` ne doit plus porter un ordre SQL duplique: il renvoie vers le runbook, le manifeste et le catalogue
- Le lot 10 ajoute:
  - une queue `email_notification_queue`
  - un dispatch email via API route sécurisée
  - une alerte incident qui déclenche notification applicative + email
  - un déclenchement périodique à faire via scheduler externe en environnement Vercel Hobby
- Le lot 11 ajoute:
  - une table `user_notification_preferences`
  - des préférences applicatives et email par type de notification
  - un filtrage des notifications visibles, du compteur des non lus et de la queue email
  - une alarme visuelle globale en haut à droite de l'application
- Le lot 12 ajoute:
  - des RPC de supervision de la queue email pour CEO/DAF
  - une page `Supervision email`
  - des métriques d'exploitation, filtres et recherche
  - des actions de reprise manuelle et d'annulation
- Le lot 13 ajoute:
  - des templates email spécialisés par scénario métier
  - des préférences fines par sous-type de workflow
  - un filtrage app/email avancé sur les notifications pending et résultat
- Le lot 14 ajoute:
  - des tables `notification_template_configs` et `notification_routing_rules`
  - une page de gouvernance pour CEO/DAF
  - un routage pilotable sans recoder, avec fallback métier
  - des modèles de notifications et emails pilotables sans recoder
- La stabilisation d'exploitation des notifications est documentée dans:
  - `docs/EMAIL_OPERATIONS_RUNBOOK_2026-03-11.md`
  - `docs/POST_DEPLOY_SMOKE_TEST_2026-03-11.md`
- Un hotfix SQL ciblé existe pour la stabilisation post-lot-14 si nécessaire:
  - `sql/hotfix_2026_03_11_workflow_maintenance_and_governance_audit.sql`
  - `sql/hotfix_2026_03_11_notifications_read_only_transaction.sql`
  - `sql/hotfix_2026_03_12_cross_company_operational_leadership.sql` pour l'alignement cross-societes CEO/DAF/Resp. maintenance avec approbation workflow conservee sur CEO/DAF
  - `sql/hotfix_2026_04_27_maintenance_daf_ceo_sequential_approval.sql` pour rendre obligatoire le flux maintenance DAF conformite puis CEO accord de demarrage
  - `sql/hotfix_2026_04_29_auto_asset_status_after_maintenance_close.sql` pour recalculer automatiquement le statut actif apres cloture maintenance

## SQL de référence

Le chemin standard à jour pour une base neuve ou pour un rattrapage prod est documenté dans:

- `docs/SQL_RUNBOOK_2026-03-10.md`
- `sql/sql_manifest_2026-03-10.json`
- `docs/SQL_CATALOG_2026-03-10.md`

Ne pas reconstruire l'ordre SQL à partir des conversations précédentes. Le manifeste et le runbook font foi.

## Etat technique courant

- Le dashboard dépend de:
  - `dashboard_summary`
  - `dashboard_insurance_expiring_2w`
  - `list_data_health_issues_secure`
- Le journal d'audit dépend de:
  - `audit_logs`
  - `search_audit_logs_secure`
  - `get_user_labels`
- Les workflows dépendent de:
  - `workflow_requests`
  - `workflow_request_approvals`
  - `request_asset_delete`
  - `request_asset_purchase_value_change`
  - `request_maintenance_start`
  - `request_asset_rebus`
  - `approve_workflow_request`
  - `reject_workflow_request`
- Les notifications dépendent désormais de:
  - `notifications`
  - `email_notification_queue`
  - `user_notification_preferences`
  - `claim_email_notification_batch`
  - `list_email_notification_queue_secure`
  - `get_email_notification_metrics_secure`
  - `/api/notifications/email-dispatch`

## Prochain chantier prioritaire

Le prochain lot à cadrer est:

15. Gouvernance avancée par société, criticité et digests

Objectif:
- piloter le ciblage par société ou criticité sans retoucher le code
- préparer des digests et escalades de notification plus contextuels

## Backlog restant après le lot 14

- Gouvernance par société, criticité et digests de notification
