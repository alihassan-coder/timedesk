import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** AES-256-GCM. Output format: v1.<iv>.<authTag>.<ciphertext>, all base64url. */
const keyFrom = (secret: string) => createHash('sha256').update(secret).digest()

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decryptSecret(token: string, secret: string): string {
  const [version, iv, tag, data] = token.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}
