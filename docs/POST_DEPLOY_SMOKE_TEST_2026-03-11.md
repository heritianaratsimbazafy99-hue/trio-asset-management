# Smoke test post-déploiement Trio Asset Management

Date de mise à jour: 2026-03-11

Ce smoke test couvre en priorité les lots 10 à 14 après déploiement:

- email transactionnel
- préférences notifications
- supervision email
- templates avancés
- gouvernance du routage

## 1. Pré requis

- un compte `CEO` ou `DAF`
- un compte utilisateur standard connecté
- un actif de test existant
- email opérationnel si le dispatch email est activé

## 2. Smoke test court

### 2.1 Vérification d'accès

Se connecter avec un compte `CEO` ou `DAF` puis vérifier le chargement sans erreur de:

- `/dashboard`
- `/notifications`
- `/notifications/operations`
- `/notifications/governance`
- `/approvals`

Se connecter ensuite avec un compte non leadership et vérifier:

- accès refusé sur `/notifications/operations`
- accès refusé sur `/notifications/governance`

### 2.2 Notification applicative

Avec l'utilisateur standard:

1. créer une demande de suppression d'actif ou de changement de valeur d'achat
2. vérifier qu'elle apparaît en attente

Avec le `CEO`:

1. ouvrir `/approvals`
2. vérifier la présence de la demande
3. vérifier l'augmentation du compteur de notifications non lues
4. ouvrir `/notifications`
5. vérifier que la notification pending est visible
6. marquer la notification comme lue

Résultat attendu:

- la demande apparaît en attente côté approbateur
- le compteur non lu est cohérent
- l'action `marquer comme lue` fonctionne

### 2.3 Queue email et dispatch

Si les emails sont activés:

1. vérifier dans `/notifications/operations` qu'une ligne est créée dans la queue
2. déclencher manuellement le dispatch HTTP
3. recharger la supervision

Commande de test:

```bash
curl -X POST "https://<votre-domaine>/api/notifications/email-dispatch?limit=20" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json"
```

Résultat attendu:

- la réponse HTTP retourne `ok: true`
- la ligne passe à `SENT` ou à `FAILED` avec erreur explicite exploitable

### 2.4 Préférences notifications

Avec un utilisateur connecté:

1. ouvrir `/notifications`
2. vérifier le chargement des préférences
3. enregistrer une modification simple

Résultat attendu:

- l'enregistrement réussit sans erreur RPC
- la page recharge correctement les préférences et les notifications

### 2.5 Gouvernance notifications

Avec un `CEO` ou `DAF`:

1. ouvrir `/notifications/governance`
2. vérifier le chargement des scénarios de routage
3. vérifier le chargement des modèles

Résultat attendu:

- la page charge sans erreur
- les scénarios `WORKFLOW_PENDING` et `INCIDENT_ALERT` sont visibles
- les modèles `WORKFLOW_*` et `INCIDENT_ALERT` sont visibles

## 3. Vérification SQL rapide

Dans SQL Editor avec simulation `CEO`:

```sql
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '<CEO_USER_UUID>', false);

select public.get_unread_notifications_count();

select *
from public.list_notifications_secure('ALL', 20, 0);

select *
from public.get_email_notification_metrics_secure();

select *
from public.list_email_notification_queue_secure('ALL', 'ALL', null, 20, 0);
```

## 4. Critères de sortie

Le déploiement est considéré comme stabilisé si:

- les pages critiques chargent sans erreur
- les rôles d'accès sont respectés
- une notification pending remonte correctement
- la queue email est visible et pilotable
- aucun blocage silencieux n'est observé sur le dispatch ou la supervision
