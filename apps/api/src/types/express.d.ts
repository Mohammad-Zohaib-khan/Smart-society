import type { AuthContext } from '../lib/context.js';

declare global {
  namespace Express {
    interface Request {
      ctx?: AuthContext;
    }
  }
}

export {};
