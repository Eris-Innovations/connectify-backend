import { connectMongo } from '../src/config/db';
import mongoose from 'mongoose';
import { normalizePhone } from '../src/lib/phone';
import { UserModel } from '../src/modules/users/user.model';

async function run() {
  await connectMongo();
  const users = await UserModel.find({ phone: { $exists: true, $ne: '' } }).select('email phone').lean();
  const owners = new Map<string, string[]>();
  const invalid: { email: string; phone: string }[] = [];

  for (const user of users) {
    const raw = String(user.phone ?? '');
    const normalized = normalizePhone(raw);
    if (!normalized) {
      invalid.push({ email: user.email, phone: raw });
      continue;
    }
    owners.set(normalized, [...(owners.get(normalized) ?? []), user.email]);
  }

  const conflicts = [...owners.entries()]
    .filter(([, emails]) => emails.length > 1)
    .map(([phone, emails]) => ({ phone, emails }));
  console.log(JSON.stringify({ scanned: users.length, invalid, conflicts }, null, 2));
  process.exitCode = invalid.length || conflicts.length ? 1 : 0;
  await mongoose.disconnect();
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
