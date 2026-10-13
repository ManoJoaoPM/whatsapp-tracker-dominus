import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../services/connectionInvite.js';

/**
 * Request limiter for public endpoints. In memory, so it limits per server process, which is
 * what a single Docker container needs. Behind a reverse proxy set TRUST_PROXY so `req.ip` is
 * the real client and not the proxy.
 */
export const rateLimit = (options: {
  windowMs: number;
  max: number;
  /** what is being limited: defaults to the client IP */
  key?: (req: Request) => string;
}) => {
  const limiter = new RateLimiter(options.windowMs, options.max);
  const sweeper = setInterval(() => limiter.sweep(), Math.max(options.windowMs, 60_000));
  sweeper.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.key ? options.key(req) : String(req.ip || 'unknown');
    const result = limiter.hit(key);
    if (result.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({ message: 'Muitas tentativas. Aguarde um instante e tente de novo.', retryAfterSeconds: result.retryAfterSeconds });
  };
};
