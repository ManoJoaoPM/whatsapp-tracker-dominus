import jwt from 'jsonwebtoken';

export const getJwtSecret = (): string => {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  return secret;
};

export const signAuthToken = (id: string): string => {
  return jwt.sign({ id }, getJwtSecret(), { expiresIn: '30d' });
};

export const verifyAuthToken = (token: string): { id: string } => {
  const decoded = jwt.verify(token, getJwtSecret()) as { id?: string };
  if (!decoded?.id) throw new Error('Invalid token payload');
  return { id: String(decoded.id) };
};
