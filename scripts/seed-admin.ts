/**
 * Upserts a super_admin user for local/staging admin dashboard login.
 *
 * Set in backend/.env (never commit real passwords):
 *   SEED_ADMIN_EMAIL=you@example.com
 *   SEED_ADMIN_PASSWORD=your-strong-password
 * Optional:
 *   SEED_ADMIN_NAME=Display Name
 *   SEED_ADMIN_USERNAME=handle   (default: local-part of email before @)
 *
 * Production: also set SEED_ADMIN_CONFIRM=yes
 */
import { env } from '../src/config/env';
import { connectMongo } from '../src/config/db';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserModel } from '../src/modules/users/user.model';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Add it to backend/.env — see backend/.env.example`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SEED_ADMIN_PASSWORD');
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Connectify Admin';
  const rawUser = process.env.SEED_ADMIN_USERNAME?.trim();
  const username = (rawUser || email.split('@')[0] || 'admin').toLowerCase();

  if (env.NODE_ENV === 'production' && process.env.SEED_ADMIN_CONFIRM !== 'yes') {
    console.error('Refusing to seed in production without SEED_ADMIN_CONFIRM=yes');
    process.exit(1);
  }

  await connectMongo();
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await UserModel.findOne({ email });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'super_admin';
    existing.isVerified = true;
    existing.hasCompletedProfile = true;
    existing.name = name;
    if (!existing.username || existing.username !== username) {
      const clash = await UserModel.findOne({ username, _id: { $ne: existing._id } });
      if (clash) {
        console.error(`Username "${username}" is taken by another user. Set SEED_ADMIN_USERNAME in .env.`);
        process.exit(1);
      }
      existing.username = username;
    }
    await existing.save();
    console.log(`Updated existing user → super_admin: ${email}`);
  } else {
    const clash = await UserModel.findOne({ username });
    if (clash) {
      console.error(`Username "${username}" already exists. Set SEED_ADMIN_USERNAME in .env to a unique value.`);
      process.exit(1);
    }
    await UserModel.create({
      email,
      username,
      name,
      passwordHash,
      role: 'super_admin',
      isVerified: true,
      hasCompletedProfile: true
    });
    console.log(`Created super_admin: ${email} (username: ${username})`);
  }

  await mongoose.disconnect();
  console.log('Done. Sign in at the admin panel with this email and password.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
