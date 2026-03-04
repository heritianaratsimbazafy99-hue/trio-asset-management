# TRIO Asset Management

Application Next.js + Supabase pour la gestion d'actifs multi-sociétés (TRIO), avec contrôle d'accès par rôles, audit, maintenance/incidents et dashboard de pilotage.

## Stack

- Frontend: Next.js 14, React 18
- Data/Auth/Storage: Supabase (Postgres + RLS + RPC)
- Charts: Recharts

## Rôles applicatifs

- `CEO`
- `DAF`
- `RESPONSABLE`
- `RESPONSABLE_MAINTENANCE`

## Prérequis

- Node.js 18+
- Projet Supabase actif
- Variables d'environnement:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Installation locale

```bash
cd "/Users/heritiana/Documents/Codex test"
npm install
npm run dev
```

## Ordre SQL recommandé (Supabase SQL Editor)

### Initialisation complète (nouvel environnement)

1. `supabase_schema.sql`
2. `sql/group_mode_roles_setup.sql`
3. `sql/security_admin_audit_upgrade.sql`
4. `sql/feature_audit_assignment_history.sql`
5. `sql/predeploy_hardening.sql`
6. `sql/assignment_update_ceo_daf_and_history_names.sql`
7. `sql/fix_assignment_history_fk_trigger.sql`
8. `sql/step_1_security_integrity_hardening.sql`
9. `sql/step_2_secure_search_and_dashboard_rpc.sql`
10. `sql/step_3_post_migration_checks.sql`
11. `sql/step_4_user_labels_email_patch.sql`

### Environnement déjà en production

Exécuter au minimum:

1. `sql/step_1_security_integrity_hardening.sql`
2. `sql/step_2_secure_search_and_dashboard_rpc.sql`
3. `sql/step_3_post_migration_checks.sql`
4. `sql/step_4_user_labels_email_patch.sql`

## Ce qui est renforcé

- Verrouillage des updates d'actifs (RLS + trigger sensible par rôle/colonne)
- Workflow incident forcé en création `OUVERT`, clôture réservée leadership maintenance
- RPC de recherche sécurisée pour `assets` et `audit_logs` (plus de `.or(...)` dynamique)
- Dashboard alimenté par agrégation SQL (`dashboard_summary`) avec pagination serveur
- `refresh_user_directory()` limité CEO/service role
- Calcul SLA corrigé en fin de journée locale (timezone-safe)
- Export PDF dashboard protégé contre injection HTML

## Vérifications qualité

```bash
npm run check:predeploy
npm run check:build
npm run check
```

## Vérification fonctionnelle

Checklist de tests rôles/RLS/audit/dashboard:

- [docs/verification_security_role_matrix.md](/Users/heritiana/Documents/Codex test/docs/verification_security_role_matrix.md)

## Déploiement production

```bash
cd "/Users/heritiana/Documents/Codex test"
git status
git add -A
git commit -m "feat: security hardening + secure search + scalable dashboard rpc"
git push origin main
npx vercel --prod
```

## Post-déploiement (smoke test)

1. Créer un actif (`/assets/new`) et vérifier succès.
2. Créer un incident en forçant un statut non `OUVERT` (doit rester `OUVERT`).
3. Clôturer un incident avec `RESPONSABLE_MAINTENANCE` (succès) et avec utilisateur standard (refus).
4. Vérifier recherche `/assets` et `/audit-logs` avec pagination.
5. Vérifier le dashboard (chargement rapide, top risques paginé).
