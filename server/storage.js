import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import seedMoments from '../data/moments.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'data');
const momentsFile = join(dataDir, 'moments.json');
const memoriesFile = join(dataDir, 'memories.json');
const membersFile = join(dataDir, 'members.json');
let localWriteQueue = Promise.resolve();
let sqliteDatabase;

export async function getMoments() {
  if (process.env.VERCEL) return seedMoments;
  return JSON.parse(await readFile(momentsFile, 'utf8'));
}

function driver() {
  const configured = (process.env.DATABASE_DRIVER || '').toLowerCase();
  if (configured) return configured;
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'file';
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function ensurePersistentDriver() {
  if (process.env.VERCEL && ['file', 'sqlite'].includes(driver())) {
    throw new Error('Persistent database is not configured. Set DATABASE_DRIVER=supabase and configure Supabase for Vercel.');
  }
}

function matchesToken(hash, token) {
  if (typeof hash !== 'string' || typeof token !== 'string' || !token) return false;
  const stored = Buffer.from(hash, 'hex');
  const supplied = Buffer.from(hashToken(token), 'hex');
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

async function databaseRequest(path, options = {}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is selected but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  }
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}

async function getSqlite() {
  if (process.env.VERCEL) throw new Error('SQLite is local-only on Vercel. Select DATABASE_DRIVER=supabase and configure Supabase.');
  if (!sqliteDatabase) {
    const { DatabaseSync } = await import('node:sqlite');
    await mkdir(dataDir, { recursive: true });
    const path = process.env.SQLITE_PATH || join(dataDir, 'backscroll.sqlite');
    sqliteDatabase = new DatabaseSync(path);
    sqliteDatabase.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS members (
        public_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        moment_id TEXT,
        member_public_id TEXT,
        member_display_name TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL CHECK (length(text) BETWEEN 12 AND 500),
        era TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_status_created_idx ON memories (status, created_at);
      CREATE INDEX IF NOT EXISTS memories_moment_status_idx ON memories (moment_id, status);
      CREATE INDEX IF NOT EXISTS memories_member_idx ON memories (member_public_id);
    `);
  }
  return sqliteDatabase;
}

async function updateLocalFiles(update) {
  let result;
  localWriteQueue = localWriteQueue.catch(() => {}).then(async () => {
    const [memories, members] = await Promise.all([
      readLocalJson(memoriesFile),
      readLocalJson(membersFile)
    ]);
    result = update({ memories, members });
    await mkdir(dataDir, { recursive: true });
    await Promise.all([
      writeFile(memoriesFile, JSON.stringify(memories, null, 2)),
      writeFile(membersFile, JSON.stringify(members, null, 2))
    ]);
  });
  await localWriteQueue;
  return result;
}

async function readLocalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function getMemories() {
  switch (driver()) {
    case 'supabase': return databaseRequest('memories?select=*&order=created_at.asc');
    case 'sqlite': return (await getSqlite()).prepare('SELECT * FROM memories ORDER BY created_at ASC').all();
    case 'file': return readLocalJson(memoriesFile);
    default: throw new Error(`Unknown DATABASE_DRIVER "${driver()}". Choose file, sqlite, or supabase.`);
  }
}

export async function createMember(member) {
  const record = { publicId: member.publicId, displayName: member.displayName, tokenHash: hashToken(member.token), createdAt: member.createdAt };
  switch (driver()) {
    case 'supabase': {
      await databaseRequest('members', { method: 'POST', body: JSON.stringify({ public_id: record.publicId, display_name: record.displayName, token_hash: record.tokenHash, created_at: record.createdAt }) });
      return { publicId: record.publicId, displayName: record.displayName, createdAt: record.createdAt };
    }
    case 'sqlite': {
      (await getSqlite()).prepare('INSERT INTO members (public_id, display_name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(record.publicId, record.displayName, record.tokenHash, record.createdAt);
      return { publicId: record.publicId, displayName: record.displayName, createdAt: record.createdAt };
    }
    case 'file':
      ensurePersistentDriver();
      await updateLocalFiles(({ members }) => members.push(record));
      return { publicId: record.publicId, displayName: record.displayName, createdAt: record.createdAt };
    default: throw new Error(`Unknown DATABASE_DRIVER "${driver()}". Choose file, sqlite, or supabase.`);
  }
}

export async function authenticateMember(publicId, token) {
  let member;
  switch (driver()) {
    case 'supabase': {
      const rows = await databaseRequest(`members?public_id=eq.${encodeURIComponent(publicId)}&select=public_id,display_name,token_hash`);
      member = rows[0] && { publicId: rows[0].public_id, displayName: rows[0].display_name, tokenHash: rows[0].token_hash };
      break;
    }
    case 'sqlite': {
      const row = (await getSqlite()).prepare('SELECT public_id, display_name, token_hash FROM members WHERE public_id = ?').get(publicId);
      member = row && { publicId: row.public_id, displayName: row.display_name, tokenHash: row.token_hash };
      break;
    }
    case 'file': {
      const members = await readLocalJson(membersFile);
      member = members.find((item) => item.publicId === publicId);
      break;
    }
    default: throw new Error(`Unknown DATABASE_DRIVER "${driver()}". Choose file, sqlite, or supabase.`);
  }
  if (!member || !matchesToken(member.tokenHash, token)) return null;
  return { publicId: member.publicId, displayName: member.displayName || '' };
}

export async function createMemory(memory) {
  const record = {
    id: memory.id,
    momentId: memory.momentId || null,
    memberId: memory.memberId || null,
    memberDisplayName: memory.memberDisplayName || '',
    text: memory.text,
    era: memory.era,
    region: memory.region,
    language: memory.language,
    status: 'pending',
    createdAt: memory.createdAt
  };
  switch (driver()) {
    case 'supabase': {
      await databaseRequest('memories', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: record.id, moment_id: record.momentId, member_public_id: record.memberId, member_display_name: record.memberDisplayName, text: record.text, era: record.era, region: record.region, language: record.language, status: record.status, created_at: record.createdAt }) });
      return record;
    }
    case 'sqlite':
      (await getSqlite()).prepare('INSERT INTO memories (id, moment_id, member_public_id, member_display_name, text, era, region, language, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.momentId, record.memberId, record.memberDisplayName, record.text, record.era, record.region, record.language, record.status, record.createdAt);
      return record;
    case 'file':
      ensurePersistentDriver();
      await updateLocalFiles(({ memories }) => memories.push(record));
      return record;
    default: throw new Error(`Unknown DATABASE_DRIVER "${driver()}". Choose file, sqlite, or supabase.`);
  }
}

export async function moderateMemory(id, status) {
  const reviewedAt = new Date().toISOString();
  switch (driver()) {
    case 'supabase': {
      const rows = await databaseRequest(`memories?id=eq.${encodeURIComponent(id)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, reviewed_at: reviewedAt }) });
      return rows[0] || null;
    }
    case 'sqlite': {
      const db = await getSqlite();
      db.prepare('UPDATE memories SET status = ?, reviewed_at = ? WHERE id = ?').run(status, reviewedAt, id);
      return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) || null;
    }
    case 'file':
      ensurePersistentDriver();
      return updateLocalFiles(({ memories }) => {
        const memory = memories.find((item) => item.id === id);
        if (!memory) return null;
        memory.status = status;
        memory.reviewedAt = reviewedAt;
        return memory;
      });
    default: throw new Error(`Unknown DATABASE_DRIVER "${driver()}". Choose file, sqlite, or supabase.`);
  }
}
