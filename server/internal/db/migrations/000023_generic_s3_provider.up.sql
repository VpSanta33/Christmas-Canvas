-- MinIO was never a required service. Keep the S3-compatible client while using a
-- provider-neutral label in the administrator UI and fresh database rows.
ALTER TABLE storage_settings ALTER COLUMN provider SET DEFAULT 's3';
UPDATE storage_settings SET provider = 's3' WHERE provider = 'minio';
