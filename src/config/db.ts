import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env';

let dnsPrepared = false;

function prepareMongoDns(): void {
  if (dnsPrepared) return;
  dnsPrepared = true;

  // Atlas SRV/TXT lookups can time out on some local resolvers; pin public resolvers once
  // so server boot, scripts, and tests all share the same behavior.
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

export async function connectMongo(): Promise<void> {
  prepareMongoDns();
  await mongoose.connect(env.MONGODB_URI);
}
