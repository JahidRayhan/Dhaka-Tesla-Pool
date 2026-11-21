# Database

`migrations/` — forward-only SQL, applied by `node scripts/migrate.js` (also run automatically at start-up when
`RUN_MIGRATIONS=true`). Each file runs in its own transaction with its bookkeeping row; a file edited after it
was applied is refused (checksum), so write a NEW migration instead of editing an old one.

`seeds/reference.sql` — the zone list, road graph and placeholder meeting points. Safe in every environment.
`seeds/demo.sql` — fake users with a PUBLIC password and free wallets. **Never in production**
(`scripts/seed.js` refuses unless `ALLOW_DEMO_SEED=true`). If a real database was ever demo-seeded, run
`node scripts/disable-demo-accounts.js` once.

## Adopting a database that was migrated by hand (the existing Render database)

The runner refuses a database that has tables but no history. Tell it which migration was the LAST one you ran by
hand, and it applies only the newer ones:

```bash
# from your computer, using the database's EXTERNAL connection string
DATABASE_URL='postgres://…' node backend/scripts/migrate.js --status     # (empty history is fine)
DATABASE_URL='postgres://…' node backend/scripts/migrate.js --baseline 004   # use YOUR last number
DATABASE_URL='postgres://…' node backend/scripts/migrate.js
```

Check what you have first: `\dt` in psql. `pool_join_consents` ⇒ 004 ran; `wallet_transactions` ⇒ 005;
`idx_consents_pending_age` ⇒ 006; `uq_pools_one_active_per_tesla` ⇒ 007. Before 007, make sure no Tesla has two
live pools (query in the system report, §12) or the unique index cannot be created.

## Operations

- `scripts/backup.sh` / `scripts/restore-check.sh` — dump, and PROVE a dump restores. A backup never restored is a hope.
- `scripts/reconcile.js` — do wallet balances equal opening balance + ledger? (exit code 1 if not). Runs nightly in-app too.
- `.github/workflows/backup.yml` — nightly dump (needs the `BACKUP_DATABASE_URL` secret).
