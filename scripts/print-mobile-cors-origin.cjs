/**
 * Reads Mobile/.env for EXPO_PUBLIC_CLIENT_ORIGIN (optional reference).
 * Backend CORS allows all origins by default; this is only if you add a whitelist later.
 * Usage (from backend/): npm run cors:from-mobile
 */
const fs = require('fs');
const path = require('path');

const mobileEnvPath = path.join(__dirname, '..', '..', 'Mobile', '.env');

if (!fs.existsSync(mobileEnvPath)) {
  console.error('Mobile/.env not found at:', mobileEnvPath);
  process.exit(1);
}

const raw = fs.readFileSync(mobileEnvPath, 'utf8');
const match = raw.match(/^\s*EXPO_PUBLIC_CLIENT_ORIGIN\s*=\s*(.+)$/m);
const val = match ? match[1].trim().replace(/^["']|["']$/g, '') : '';

if (!val) {
  console.log('# No EXPO_PUBLIC_CLIENT_ORIGIN in Mobile/.env (OK for APK-only; backend still allows missing Origin).');
  console.log('# Add e.g. EXPO_PUBLIC_CLIENT_ORIGIN=https://your-expo-web.com for Expo web production.');
  process.exit(0);
}

console.log('Suggested value if you restrict CORS later:\n');
console.log(`CLIENT_ORIGIN=${val}`);
