import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import { env } from '../config/env';

export type AuthUser = {
  userId: string;
  role?: 'user' | 'admin' | 'super_admin' | 'moderator' | 'analyst';
};

export type AuthedRequest = Request & { auth?: AuthUser };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.replace('Bearer ', '') : null;
  if (!token) {
    res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: 'Missing auth token' });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUser;
    req.auth = payload;
    next();
  } catch {
    res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: 'Invalid token' });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.auth?.role || !['admin', 'super_admin', 'moderator', 'analyst'].includes(req.auth.role)) {
      res.status(StatusCodes.FORBIDDEN).json({ success: false, message: 'Admin access required' });
      return;
    }
    next();
  });
}

export function requireAdminRoles(roles: Array<'admin' | 'super_admin' | 'moderator' | 'analyst'>) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      const role = req.auth?.role;
      if (!role || !roles.includes(role as 'admin' | 'super_admin' | 'moderator' | 'analyst')) {
        res.status(StatusCodes.FORBIDDEN).json({ success: false, message: 'Insufficient admin permissions' });
        return;
      }
      next();
    });
  };
}

