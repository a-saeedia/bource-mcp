/**
 * Session store — encrypted at rest with AES-256-GCM.
 *
 * The model never sees credentials: the human logs in once via
 * `npm run login` (headed browser, OTP, everything) and the resulting
 * cookies are stored here encrypted. The MCP bridge only ever *uses* the
 * session to read pages — read-only.
 *
 * Key: BOURCE_SESSION_KEY env, or a generated key file in BOURCE_DATA_DIR.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dataDir = () => process.env.BOURCE_DATA_DIR || path.join(os.homedir(), '.bource-mcp');
const sessionsDir = () => path.join(dataDir(), 'sessions');

function key() {
  const env = process.env.BOURCE_SESSION_KEY;
  if (env) return createHash('sha256').update(env).digest();
  const kf = path.join(dataDir(), 'session.key');
  if (!existsSync(kf)) {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(kf, randomBytes(32), { mode: 0o600 });
  }
  return readFileSync(kf);
}

export function saveSession(name, payload) {
  mkdirSync(sessionsDir(), { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const buf = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const file = path.join(sessionsDir(), `${name}.enc`);
  writeFileSync(file, Buffer.concat([iv, cipher.getAuthTag(), buf]));
  return { name, file, host: payload.host ?? null };
}

export function loadSession(name) {
  const file = path.join(sessionsDir(), `${name}.enc`);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(json);
}

export function listSessions() {
  if (!existsSync(sessionsDir())) return [];
  return readdirSync(sessionsDir())
    .filter((f) => f.endsWith('.enc'))
    .map((f) => ({ name: f.replace(/\.enc$/, ''), file: path.join(sessionsDir(), f) }));
}

export function deleteSession(name) {
  const file = path.join(sessionsDir(), `${name}.enc`);
  if (existsSync(file)) rmSync(file);
}
