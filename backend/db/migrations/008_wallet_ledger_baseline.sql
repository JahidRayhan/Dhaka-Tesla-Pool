-- 008: make wallet balances auditable.
--
-- The ledger (wallet_transactions) only records movements since TeslaPay went
-- live; wallets that existed before it (and the demo seed's opening balance)
-- started with money that has no ledger row. ledger_baseline_paisa records that
-- opening amount, so the invariant
--
--     balance_paisa = ledger_baseline_paisa + SUM(wallet_transactions.amount_paisa)
--
-- holds for EVERY wallet and a nightly reconciliation can flag any drift.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS ledger_baseline_paisa BIGINT NOT NULL DEFAULT 0;

UPDATE wallets w
SET ledger_baseline_paisa = w.balance_paisa - COALESCE(
  (SELECT SUM(t.amount_paisa) FROM wallet_transactions t WHERE t.user_id = w.user_id), 0);
