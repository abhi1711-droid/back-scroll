import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { authenticateMember, createMember, createMemory, getMemories, getMoments, moderateMemory } from './storage.js';

async function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    if (req.body && typeof req.body === 'object') return req.body;
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}

function authorized(req) {
  const expected = process.env.ADMIN_TOKEN || '';
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/api/moments' && req.method === 'GET') {
      const moments = await getMoments();
      const fromYear = Number(url.searchParams.get('fromYear'));
      const toYear = Number(url.searchParams.get('toYear'));
      const year = Number(url.searchParams.get('year'));
      const category = url.searchParams.get('category');
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const results = moments.filter((item) => {
        const start = fromYear || toYear || year;
        const end = toYear || fromYear || year;
        const yearMatch = !start || (item.year <= end && (item.endYear || item.year) >= start);
        const categoryMatch = !category || category === 'All' || item.category === category;
        const qMatch = !q || [item.title, item.description, item.category, ...(item.tags || [])].join(' ').toLowerCase().includes(q);
        return yearMatch && categoryMatch && qMatch;
      }).sort((a, b) => a.year - b.year);
      return sendJson(res, 200, { moments: results, total: results.length });
    }
    if (url.pathname === '/api/memories' && req.method === 'GET') {
      const memories = await getMemories();
      const momentId = url.searchParams.get('momentId');
      const published = memories.filter((item) => item.status === 'approved' && (!momentId || (item.momentId || item.moment_id) === momentId)).map((item) => ({ id: item.id, momentId: item.momentId || item.moment_id, text: item.text, era: item.era, region: item.region, language: item.language, memberId: item.memberId || item.member_public_id || null, memberDisplayName: item.memberDisplayName || item.member_display_name || '', createdAt: item.createdAt || item.created_at }));
      return sendJson(res, 200, { memories: published });
    }
    if (url.pathname === '/api/members' && req.method === 'POST') {
      const body = await readBody(req);
      const displayName = typeof body.displayName === 'string' ? body.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
      const memberId = `BS-${randomBytes(5).toString('hex').toUpperCase()}`;
      const memberToken = randomBytes(32).toString('base64url');
      const member = { publicId: memberId, displayName, token: memberToken, createdAt: new Date().toISOString() };
      await createMember(member);
      return sendJson(res, 201, { ok: true, memberId, displayName, memberToken, message: 'Your member ID is ready. Save your private recovery key; it is shown only once.' });
    }
    if (url.pathname === '/api/members/verify' && req.method === 'POST') {
      const body = await readBody(req);
      const member = await authenticateMember(String(body.memberId || ''), String(body.memberToken || ''));
      if (!member) return sendJson(res, 401, { error: 'That member ID and recovery key do not match.' });
      return sendJson(res, 200, { ok: true, memberId: member.publicId, displayName: member.displayName });
    }
    if (url.pathname === '/api/memories' && req.method === 'POST') {
      const body = await readBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text.length < 12 || text.length > 500) return sendJson(res, 400, { error: 'Memory must be between 12 and 500 characters.' });
      const moments = await getMoments();
      if (body.momentId && !moments.some((item) => item.id === body.momentId)) return sendJson(res, 400, { error: 'That moment could not be found.' });
      const memberId = req.headers['x-member-id'];
      const memberToken = req.headers['x-member-token'];
      if (Boolean(memberId) !== Boolean(memberToken)) return sendJson(res, 400, { error: 'Member ID and recovery key must be supplied together.' });
      const member = memberId && memberToken ? await authenticateMember(String(memberId), String(memberToken)) : null;
      if (memberId && !member) return sendJson(res, 401, { error: 'That member ID and recovery key do not match.' });
      const memory = { id: randomUUID(), momentId: body.momentId || null, memberId: member?.publicId || null, memberDisplayName: member?.displayName || '', text, era: String(body.era || '').slice(0, 40), region: String(body.region || '').slice(0, 80), language: String(body.language || '').slice(0, 40), status: 'pending', createdAt: new Date().toISOString() };
      await createMemory(memory);
      return sendJson(res, 201, { ok: true, message: 'Thanks for adding a memory. It will appear after review.', memberId: memory.memberId });
    }
    if (url.pathname === '/api/admin/memories' && req.method === 'GET') {
      if (!authorized(req)) return sendJson(res, process.env.ADMIN_TOKEN ? 401 : 503, { error: process.env.ADMIN_TOKEN ? 'Invalid admin token.' : 'Admin access is not configured. Set ADMIN_TOKEN on the server.' });
      const memories = await getMemories();
      return sendJson(res, 200, { memories: memories.filter((item) => item.status === 'pending').map((item) => ({ id: item.id, momentId: item.momentId || item.moment_id, text: item.text, era: item.era, region: item.region, language: item.language, memberId: item.memberId || item.member_public_id || null, memberDisplayName: item.memberDisplayName || item.member_display_name || '', createdAt: item.createdAt || item.created_at })) });
    }
    const moderationMatch = url.pathname.match(/^\/api\/admin\/memories\/([\w-]+)$/);
    if (moderationMatch && req.method === 'PATCH') {
      if (!authorized(req)) return sendJson(res, process.env.ADMIN_TOKEN ? 401 : 503, { error: process.env.ADMIN_TOKEN ? 'Invalid admin token.' : 'Admin access is not configured. Set ADMIN_TOKEN on the server.' });
      const body = await readBody(req);
      if (!['approved', 'rejected'].includes(body.status)) return sendJson(res, 400, { error: 'Status must be approved or rejected.' });
      const memory = await moderateMemory(moderationMatch[1], body.status);
      if (!memory) return sendJson(res, 404, { error: 'Memory not found.' });
      return sendJson(res, 200, { ok: true, memory });
    }
    return sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'Please send valid JSON.' });
    if (error.message === 'Request too large') return sendJson(res, 413, { error: 'Request is too large.' });
    if (error.message.startsWith('Persistent database is not configured.')) return sendJson(res, 503, { error: error.message });
    console.error(error);
    return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
