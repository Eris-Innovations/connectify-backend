import { config } from 'dotenv';
config({ path: '.env' });
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('no mongo');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  console.log('db', mongoose.connection.name);
  const cols = await db.listCollections().toArray();
  const names = cols.map((c) => c.name);
  console.log(
    'pushish',
    names.filter((n) => /push|device|token/i.test(n))
  );
  for (const name of names.filter((n) => /push|device/i.test(n))) {
    const n = await db.collection(name).countDocuments();
    console.log(name, 'count', n);
    const sample = await db
      .collection(name)
      .find({})
      .limit(3)
      .project({ userId: 1, platform: 1, fcmToken: 1, expoToken: 1, enabled: 1, callEnabled: 1, updatedAt: 1 })
      .toArray();
    for (const s of sample) {
      console.log(' sample', {
        userId: String(s.userId),
        platform: s.platform,
        enabled: s.enabled,
        callEnabled: s.callEnabled,
        hasFcm: Boolean(s.fcmToken),
        fcmLen: s.fcmToken ? String(s.fcmToken).length : 0,
        hasExpo: Boolean(s.expoToken),
        updatedAt: s.updatedAt,
      });
    }
  }
  // Also search any collection for these user ids
  for (const name of names) {
    try {
      const hit = await db.collection(name).countDocuments({
        userId: {
          $in: [
            new mongoose.Types.ObjectId('6a395ed308c58dc508dcdb29'),
            new mongoose.Types.ObjectId('6a483295eb9b6a63c22dbbdc'),
          ],
        },
      });
      if (hit > 0) console.log('userId hits in', name, hit);
    } catch {
      /* skip */
    }
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
