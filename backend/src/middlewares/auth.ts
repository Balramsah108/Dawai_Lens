// Dev auth middleware
// TODO: Replace with Firebase token verification later

import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

export interface AuthUser {
  id: string;
  phone: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // In dev mode: accept a simple header x-dev-user-id
  if (process.env.NODE_ENV === 'development') {
    const devUserId = req.headers['x-dev-user-id'] as string;
    if (devUserId) {
      // Convert any string into a deterministic UUID so PostgreSQL accepts it
      const hash = createHash('md5').update(devUserId).digest('hex');
      const uuid = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
      req.user = { id: uuid, phone: '9999999999' };
      next();
      return;
    }
  }

  // No auth provided
  res.status(401).json({
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    },
  });
};
