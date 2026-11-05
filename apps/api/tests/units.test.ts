import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/config/env.ts'
import { decryptSecret, encryptSecret } from '../src/utils/crypto.ts'

const secret = 'a-long-secret-that-is-at-least-32-chars!!'

describe('secret encryption', () => {
  it('round-trips text, including unicode', () => {
    const plain = 'sk-ant-api03-ключ-🔑'
    expect(decryptSecret(encryptSecret(plain, secret), secret)).toBe(plain)
  })

  it('produces different ciphertext each time for the same input', () => {
    expect(encryptSecret('same', secret)).not.toBe(encryptSecret('same', secret))
  })

  it('refuses to decrypt with the wrong secret', () => {
    const token = encryptSecret('hello', secret)
    expect(() => decryptSecret(token, 'another-secret-that-is-also-32-chars!!!')).toThrow()
  })

  it('refuses to decrypt data that was tampered with', () => {
    const [v, iv, tag, data] = encryptSecret('hello', secret).split('.')
    const flipped = data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptSecret([v, iv, tag, flipped].join('.'), secret)).toThrow()
  })
})

describe('environment validation', () => {
  const good = {
    DATABASE_URL: 'postgres://u:p@host/db',
    BETTER_AUTH_SECRET: 's'.repeat(32),
    KEY_ENCRYPTION_SECRET: 'k'.repeat(32),
  }

  it('accepts a complete environment and applies defaults', () => {
    const env = loadEnv(good)
    expect(env.WEB_ORIGIN).toBe('http://localhost:5173')
    expect(env.ADMIN_EMAILS).toEqual([])
  })

  it('splits and lower-cases the admin email list', () => {
    const env = loadEnv({ ...good, ADMIN_EMAILS: ' One@Example.com , two@example.com ,, ' })
    expect(env.ADMIN_EMAILS).toEqual(['one@example.com', 'two@example.com'])
  })

  it('fails loudly when a secret is missing or too short', () => {
    expect(() => loadEnv({ ...good, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => loadEnv({ ...good, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
  })
})
