/**
 * Cloudflare R2 S3-compatible API only accepts the **S3 credentials** from
 * R2 → Manage R2 API Tokens (Access Key ID is exactly 32 characters).
 * Do not use **Account API Tokens** (they start with `cfat_`, ~53 chars) — R2 rejects those for S3.
 */
export const R2_S3_ACCESS_KEY_ID_LENGTH = 32;

export function isR2S3CompatibleAccessKeyId(accessKeyId: string): boolean {
  const id = accessKeyId.trim();
  if (!id || /\s/.test(id)) return false;
  if (id.startsWith('cfat_')) return false;
  return id.length === R2_S3_ACCESS_KEY_ID_LENGTH;
}

/** Human-readable fix when uploads fail or .env is wrong. */
export const R2_S3_CREDENTIALS_HELP =
  'Use Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token with Object Read & Write on your bucket. Copy the **Access Key ID** (exactly 32 characters) and **Secret Access Key**. Do not use Account API Tokens (keys starting with cfat_) — those are not valid for the S3 API.';
