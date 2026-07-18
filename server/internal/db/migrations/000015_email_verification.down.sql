DROP TABLE IF EXISTS email_verification_challenges;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
