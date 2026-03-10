# Contexte de reprise Trio Asset Management

Date de mise à jour: 2026-03-10

## Etat fonctionnel couvert

Les lots 1 à 10 sont implémentés côté code ou documentation d'exploitation:

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

## Règles métier en vigueur

- Tout utilisateur connecté peut demander:
  - la suppression d'un actif
  - le changement de valeur d'achat
- Seul le CEO peut appliquer directement:
  - la suppression d'un actif
  - le changement de valeur d'achat
- Les demandes de suppression d'actif et de changement de valeur d'achat sont validées par le CEO
- Les tickets maintenance en attente sont validés ou refusés par CEO ou DAF
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
- Le lot 10 ajoute:
  - une queue `email_notification_queue`
  - un dispatch email via API route sécurisée
  - une alerte incident qui déclenche notification applicative + email

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
  - `claim_email_notification_batch`
  - `/api/notifications/email-dispatch`

## Prochain chantier prioritaire

Le prochain lot à cadrer est:

11. Préférences email et supervision d'envoi

Objectif:
- permettre l'opt-in / opt-out par type d'email
- exposer un suivi des envois et des échecs côté administration

## Backlog restant après le lot 10

- Préférences email et supervision d'envoi
