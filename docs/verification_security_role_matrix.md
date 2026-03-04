# Verification Matrix (Security + Workflow)

Use this checklist after running the SQL steps.

## Role test accounts

- `CEO`
- `DAF`
- `RESPONSABLE`
- `RESPONSABLE_MAINTENANCE`
- `USER_STANDARD` (any authenticated user without leadership role)

## Tests

| ID | Scenario | Account | Expected result |
|---|---|---|---|
| R1 | Update asset `purchase_value` | CEO | Success |
| R2 | Update asset `purchase_value` | DAF | Success |
| R3 | Update asset `purchase_value` | RESPONSABLE | Rejected (`forbidden: only CEO or DAF...`) |
| R4 | Update asset `purchase_value` | USER_STANDARD | Rejected by RLS |
| R5 | Update asset `status` | RESPONSABLE_MAINTENANCE | Success |
| R6 | Update asset `status` | USER_STANDARD | Rejected by RLS |
| I1 | Create incident with payload status `RESOLU` | Any authenticated user | Inserted as `OUVERT`, `resolved_by/resolved_at = null` |
| I2 | Close incident (`status = RESOLU`) | RESPONSABLE_MAINTENANCE | Success + `resolved_by/resolved_at` auto-filled |
| I3 | Close incident (`status = RESOLU`) | USER_STANDARD | Rejected |
| U1 | Execute `select public.refresh_user_directory();` | CEO | Success |
| U2 | Execute `select public.refresh_user_directory();` | USER_STANDARD | Rejected (`forbidden: only CEO...`) |
| A1 | Open `/audit-logs` and search by actor/entity/action | CEO/DAF | Server-side filtered results, pagination coherent |
| A2 | Open `/audit-logs` and search by actor/entity/action | USER_STANDARD | Access denied screen |

## Dashboard scalability checks

| ID | Scenario | Expected result |
|---|---|---|
| D1 | Open dashboard with >1000 assets in DB | Page loads without full-table client freeze |
| D2 | Change period/company/category filters | Data refreshes through RPC (`dashboard_summary`) |
| D3 | Move through top risks pages | Pagination works without loading all assets client-side |

## SQL smoke checks

Run:

```sql
-- 1) Objects + trigger/policy checks
\i sql/step_3_post_migration_checks.sql
```

Then quickly validate RPC outputs:

```sql
select * from public.search_assets_secure(null, null, 10, 0, 'created_at', 'desc');
select * from public.search_audit_logs_secure('ALL', null, 10, 0);
select public.dashboard_summary(null, 'ALL', '12M', 1, 5);
```
