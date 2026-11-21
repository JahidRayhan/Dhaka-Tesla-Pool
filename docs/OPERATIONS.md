# Operations runbook

How to deploy, upgrade, back up and troubleshoot Dhaka Tesla Pool. Written for the
setup this project uses today: **Render** (API + Postgres), **Netlify** (web), **Expo** (mobile).

---

## 1. Upgrading the already-deployed database (do this once)

Your Render database was migrated **by hand** (files 001–007), so it has no migration
history. The new runner refuses to touch a database like that until you tell it where it stands.

1. **Back it up first** (`backend/scripts/backup.sh`, or Render's dashboard snapshot).
2. In the Render **Shell** (or locally with the *external* database URL):
   ```bash
   # tell the runner what is already applied. Use the LAST number you applied by hand
   # (007 if you ran 005, 006 and 007; 004 if you stopped earlier).
   node scripts/migrate.js --baseline 007
   node scripts/migrate.js --status        # 008…015 should show as PENDING
   ```
3. Check there are no duplicate live pools (migration 007 cannot be created if there are):
   ```sql
   SELECT tesla_id, count(*) FROM pools
   WHERE status IN ('MATCHED','DRIVER_ARRIVED','STARTED') GROUP BY tesla_id HAVING count(*) > 1;
   ```
   It must return no rows. (Only needed if you have **not** applied 007 yet.)
4. Set the environment variables in section 2, then deploy the new backend. With
   `RUN_MIGRATIONS=true` it applies 008–015 on start, inside transactions, under a lock.
   If a migration fails the **API refuses to start** (by design) and nothing is half-applied.
5. From now on, new migrations apply themselves on deploy. **Never edit a migration that
   has shipped** — the runner detects it and stops. Add a new numbered file instead.

## 2. Environment variables (API)

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | turns on strict secret checks and JSON logs |
| `DATABASE_URL` | Render **internal** URL | |
| `JWT_SECRET` | `openssl rand -hex 32` | ≥ 32 chars or the API will not start. Changing it signs everyone out |
| `JWT_EXPIRES_IN` | `15m` | access token life; clients refresh silently |
| `CORS_ORIGINS` | your Netlify URL | comma-separated; unset = any origin |
| `RUN_MIGRATIONS` | `true` | |
| `SEED_REFERENCE` | `true` | zones + road graph; idempotent |
| `SEED_DEMO` | **never** | public password, free money. The API refuses it in production |
| `SIMULATED_PAYMENTS` | unset / `false` | the wallet top-up is fake money; leave it off for real users |
| `REQUIRE_VERIFIED_DRIVERS` | `true` for launch | drivers need admin approval before going online |
| `RATE_LIMIT_STORE` | `postgres` if more than one instance | otherwise each instance throttles separately |
| `SMS_PROVIDER` | `webhook` | + `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_TOKEN`. `console` just logs codes |
| `PUSH_PROVIDER` | default (`expo`) | `off` disables push |
| `LOG_LEVEL` | `info` | |

Web (Netlify): `NEXT_PUBLIC_API_URL` (no trailing slash), `STATIC_EXPORT=true` (already in `netlify.toml`).
Mobile: `EXPO_PUBLIC_API_URL`, and `EXPO_PUBLIC_WEB_URL` (the Netlify address, used to build share-my-trip links).

## 3. First real admin

The demo admin exists only in demo seeds. For a real deployment:
```bash
ADMIN_PASSWORD='a-long-passphrase-of-12+-chars' node scripts/create-admin.js you@example.com "Your Name"
```
(Leave `ADMIN_PASSWORD` out to have one generated and printed once.) Sign in on the web app; you land on `/admin`.

If the database was ever seeded with the demo data, lock those accounts: `node scripts/disable-demo-accounts.js`.

## 4. Backups

* `backend/scripts/backup.sh [dir]` makes a compressed `pg_dump`. `.github/workflows/backup.yml` runs it nightly
  (needs the `BACKUP_DATABASE_URL` secret) and keeps the file as a build artifact for 14 days.
* **Rehearse a restore** — `backend/scripts/restore-check.sh <dump> <admin-url>` restores into a throwaway database and
  counts rows. Do this once now and after any big change. An untested backup is only a hope.
* Render's free Postgres has limits (expiry, no point-in-time recovery). Before real users, move to a paid plan with backups
  and keep an off-site copy.

## 5. Watching it

* Every response has an `X-Request-Id`; a 500 body includes it as `requestId`. Search the logs for that id.
* Logs are one JSON object per line (`ts, level, msg, requestId, method, path, status, ms, userId`).
* `/health` (alive + database answers) and `/ready` (alive + schema present). Point an uptime monitor at `/health`.
* The API reconciles the books nightly and logs `WALLET RECONCILIATION FAILED` if wallets and ledger disagree. Run it on
  demand with `node scripts/reconcile.js` or open **Admin → Overview**. Treat a failure as an incident.
* Free Render instances sleep when idle; the first request after a pause takes about a minute. Wake it with `/health`.

## 6. Releasing

* **API**: merge → `pre-release` → cut `release/vX.Y.Z` → Render deploys that branch. CI (`.github/workflows/ci.yml`) must be green.
* **Web**: Netlify builds `release/…` as a static export. A new `NEXT_PUBLIC_*` value needs a rebuild.
* **Mobile**: `npm test`, then `npx expo export --platform android --platform ios` must succeed (CI does this).
  Store builds use EAS (`npx eas build`); iOS builds need an Apple developer account, Android a Google Play one.
  Old app versions stay in people's pockets — that is why the API is versioned (`/api/v1`) and the old `/api` prefix still works.

## 7. Known limits (be honest with yourself before launch)

* Payments are simulated; there is no gateway, refund or driver-payout flow.
* Distances and matching use a hand-made zone graph, not real roads.
* Real-time is polling plus push; there are no websockets.
* The mobile app has been bundled and API-tested, not run on a physical device — do that before anyone depends on it.
* Bangla copy needs a native-speaker review. Meeting points are placeholders to replace with real landmarks.
