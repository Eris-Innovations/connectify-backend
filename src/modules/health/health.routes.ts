import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'connectify-backend',
    uptime: process.uptime()
  });
});

