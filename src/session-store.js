/**
 * Encrypted session store (AES-256-GCM).
 *
 * Sessions hold ONLY browser cookies for the TSE portal — credentials are
 * never saved. Each session is one JSON file under BOURCE_DATA_DIR/sessions.
 * The encryption key lives in BOURCE_DATA_DIR/key (mode 0600) unless
 * BOOURCE_SESSION_KEY is set (env takes precedence).
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const dataDir = process.env.BOURCE_DATA_DIR || join(homedir(), '.bource-mcp');
const sessionsDir = join(dataDir, 'sessions');
const keyFile = join(dataDir, 'key');
const ALGO = 'aes-256-gcm';

function baseKey() {
  return process.env.BOURCE_SESSION_KEY || readFileSync(keyFile, 'utf8').trim();
}

function ensureKey() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(keyFile)) {
    const key = randomBytes(32).toString('hex');
    writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' });
  }
}

function encrypt(plain) {
  const key = createHash('sha256').update(baseKey()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const buf = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: buf.toString('base64') });
}

function decrypt(blob) {
  const { v, iv, tag, data } = JSON.parse(blob);
  if (v !== 1) throw new Error('unsupported session blob version');
  const key = createHash('sha256').update(baseKey()).digest();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function sessionPath(name) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(sessionsDir, `${safe}.json`);
}

export function saveSession(name, value) {
  ensureKey();
  mkdirSync(sessionsDir, { recursive: true });
  const blob = encrypt({ name, savedAt: Date.now(), value });
  writeFileSync(sessionPath(name), blob, { flag: 'w' });
}

export function loadSession(name) {
  const p = sessionPath(name);
  if (!existsSync(p)) return null;
  try {
    return decrypt(readFileSync(p, 'utf8')).value;
  } catch {
    rmSync(p, { force: true });
    return null;
  }
}

export function listSessions() {
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const meta = decrypt(readFileSync(join(sessionsDir, f), 'utf8'));
        return { name: meta.name, savedAt: meta.savedAt };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteSession(name) {
  const p = sessionPath(name);
  if (existsSync(p)) { rmSync(p, { force: true }); return true; }
  return false;
}
