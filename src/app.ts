import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { resolveCorsOrigin } from './config/cors';
import { apiRouter } from './modules';
import { errorHandler, requestContext } from './shared/errors';

export function createApp() {
  const app = express();

  app.use(requestContext);
  app.use(helmet());
  app.use(
    cors({
      origin: resolveCorsOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send(
      [
        'Contact: mailto:security@connectify.io',
        'Expires: 2027-04-16T23:59:59.000Z',
        'Preferred-Languages: en',
        `Canonical: ${env.API_PREFIX}/.well-known/security.txt`,
        'Policy: https://connectify.io/security-policy',
        'Hiring: https://connectify.io/careers'
      ].join('\n')
    );
  });

  app.use(env.API_PREFIX, apiRouter);

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      errorCode: 'ROUTE_NOT_FOUND',
      requestId: res.locals.requestId
    });
  });
  app.use(errorHandler);

  return app;
}
