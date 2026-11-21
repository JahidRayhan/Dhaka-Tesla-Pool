-- 011: an operator role for the admin console. Kept in its own migration because
-- Postgres cannot use a newly added enum value in the same transaction that
-- adds it; later migrations and seeds may use 'admin' freely.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';
