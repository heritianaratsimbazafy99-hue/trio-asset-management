# TRIO Asset Management

Application Next.js + Supabase pour la gestion d'actifs multi-sociétés (TRIO), stabilisée jusqu'au lot 14:

- workflows d'approbation
- maintenance et rebus
- historique diff champ par champ
- plan de remplacement
- moteur de règles
- santé des données actionnable
- notifications applicatives
- notifications email et supervision
- préférences avancées
- gouvernance des modèles et du routage
- import massif d'actifs

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
- Variables locales minimales:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

- Variables serveur requises pour le dispatch email:

```bash
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=...
APP_BASE_URL=...
CRON_SECRET=...
```

- Variables serveur optionnelles:

```bash
EMAIL_REPLY_TO=...
EMAIL_PROVIDER=resend
EMAIL_NOTIFICATIONS_ENABLED=true
```

## Installation locale

```bash
cd "/Users/heritiana/Documents/Codex test"
npm install
npm run dev
```

## Source de vérité SQL

Ne pas dupliquer l'ordre SQL dans ce `README.md`. Les références canoniques sont:

- [docs/SQL_RUNBOOK_2026-03-10.md](docs/SQL_RUNBOOK_2026-03-10.md)
- [sql/sql_manifest_2026-03-10.json](sql/sql_manifest_2026-03-10.json)
- [docs/SQL_CATALOG_2026-03-10.md](docs/SQL_CATALOG_2026-03-10.md)

Le manifeste et le runbook priment sur toute conversation ou ancienne note de déploiement.

## Vérifications qualité

```bash
npm run check:predeploy
npm run check:build
npm run check
```

Checklist de vérification rôle/RLS/dashboard:

- [docs/verification_security_role_matrix.md](docs/verification_security_role_matrix.md)

## Exploitation

- Runbook email et scheduler: [docs/EMAIL_OPERATIONS_RUNBOOK_2026-03-11.md](docs/EMAIL_OPERATIONS_RUNBOOK_2026-03-11.md)
- Smoke test post-déploiement: [docs/POST_DEPLOY_SMOKE_TEST_2026-03-11.md](docs/POST_DEPLOY_SMOKE_TEST_2026-03-11.md)

Note d'exploitation:

- le dispatch email passe par `/api/notifications/email-dispatch`
- sur Vercel Pro, `vercel.json` déclare un cron toutes les minutes
- désactiver le cron équivalent dans `cron-job.org` après déploiement production
- sur Vercel Hobby, retirer les `crons` de `vercel.json` et utiliser un scheduler HTTP externe

## Déploiement production

```bash
cd "/Users/heritiana/Documents/Codex test"
npm run check
git status
git add -A
git commit -m "chore: stabilize lot 14 operations and docs"
git push origin main
npx vercel --prod
```
