import crypto from 'crypto';

const getMasterKey = (): Buffer => {
  const raw = String(process.env.SECRETS_MASTER_KEY || '').trim();
  if (!raw) throw new Error('SECRETS_MASTER_KEY is required');
  return crypto.createHash('sha256').update(raw).digest();
};

export const encryptForStorage = (plaintext: string): string => {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
};

export const decryptFromStorage = (packed: string): string => {
  const key = getMasterKey();
  const [ivB64, tagB64, ciphertextB64] = String(packed || '').split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) throw new Error('Invalid encrypted payload');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};

