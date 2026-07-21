import { config } from 'dotenv';
config({ path: '.env' });
import mongoose from 'mongoose';

async function summarize(
  col: mongoose.Collection,
  label: string,
  userId: mongoose.Types.ObjectId
) {
  const docs = await col
    .find({ userId })
    .project({ platform: 1, enabled: 1, callEnabled: 1, fcmToken: 1, expoToken: 1, updatedAt: 1, deviceId: 1 })
    .toArray();
  console.log(label + '_count', docs.length);
  for (const d of docs) {
    console.log({
      platform: d.platform,
      enabled: d.enabled,
      callEnabled: d.callEnabled,
      hasFcm: Boolean(d.fcmToken && String(d.fcmToken).length > 10),
      fcmLen: d.fcmToken ? String(d.fcmToken).length : 0,
      hasExpo: Boolean(d.expoToken && String(d.expoToken).length > 10),
      deviceIdPrefix: String(d.deviceId || '').slice(0, 12),
      updatedAt: d.updatedAt,
    });
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('no mongo');
  await mongoose.connect(uri);
  const col = mongoose.connection.collection('devicepushtokens');
  await summarize(col, 'fareeha', new mongoose.Types.ObjectId('6a395ed308c58dc508dcdb29'));
  await summarize(col, 'fahad', new mongoose.Types.ObjectId('6a483295eb9b6a63c22dbbdc'));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
