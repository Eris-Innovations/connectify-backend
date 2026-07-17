import http from 'http';
import dns from 'node:dns';
import { createApp } from './app';
import { env } from './config/env';
import { connectMongo } from './config/db';
import { redis } from './config/redis';
import { createSocketServer } from './sockets';
import { startTelemetry } from './observability/otel';
import { isTransactionalEmailConfigured } from './lib/email';
import { startNotificationOutboxWorker } from './modules/notifications/notification-outbox.service';

async function bootstrap() {
  // Force resolvers that support Atlas SRV lookups when local DNS is unreliable.
  dns.setServers(['8.8.8.8', '1.1.1.1']);

  await startTelemetry();
  await connectMongo();
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    // Redis is optional in local development.
  }

  const app = createApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);
  startNotificationOutboxWorker();

  httpServer.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Connectify backend running on :${env.PORT}`);
    if (!isTransactionalEmailConfigured()) {
      console.warn(
        '[email] Transactional email is not fully configured — signup and password-reset OTPs will NOT be sent by email. ' +
          'Set RESEND_API_KEY and EMAIL_FROM in backend/.env. Verify your sending domain at https://resend.com/domains. ' +
          'In development only, signup may return otpCode in JSON when Resend is disabled.'
      );
    }
  });
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap backend', error);
  process.exit(1);
});

