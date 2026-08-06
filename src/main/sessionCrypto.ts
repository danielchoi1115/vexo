import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

export interface EncryptedExportEnvelope {
  vexoEncrypted: 1
  v: 1
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export function isEncryptedExport(data: unknown): data is EncryptedExportEnvelope {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as EncryptedExportEnvelope).vexoEncrypted === 1 &&
    typeof (data as EncryptedExportEnvelope).ciphertext === 'string'
  )
}

export function encryptJson(payload: unknown, password: string): EncryptedExportEnvelope {
  if (!password) throw new Error('Password required')
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plain = Buffer.from(JSON.stringify(payload), 'utf8')
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    vexoEncrypted: 1,
    v: 1,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64')
  }
}

export function decryptJson<T>(envelope: EncryptedExportEnvelope, password: string): T {
  if (!password) throw new Error('Password required')
  const salt = Buffer.from(envelope.salt, 'base64')
  const key = scryptSync(password, salt, 32)
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as T
}
