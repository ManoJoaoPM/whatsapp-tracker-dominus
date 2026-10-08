import { Request, Response, NextFunction } from 'express';
import User from '../models/User.js';
import { verifyAuthToken } from '../config/jwt.js';

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Not authorized, no token' });
    return;
  }

  try {
    const token = header.split(' ')[1];
    const { id } = verifyAuthToken(token);
    const user = await User.findById(id).select('-passwordHash');
    if (!user) {
      res.status(401).json({ message: 'Not authorized, user not found' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const admin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};
