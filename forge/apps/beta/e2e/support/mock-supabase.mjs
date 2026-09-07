/**
 * A local stand-in for the parts of GoTrue and PostgREST that FORGE Beta calls.
 *
 * Why this exists: this sandbox cannot reach *.supabase.co (the egress proxy
 * answers 403 to CONNECT), so the fifteen authenticated pages had never been
 * rendered even once. Pointing NEXT_PUBLIC_SUPABASE_URL at this server exercises
 * the real middleware, the real cookie handling, the real query layer and the
 * real React tree — everything except Supabase itself.
 *
 * What it does NOT verify, and must never be claimed to: RLS policies, real
 * token signing/verification, PostGIS, or storage. Those need a live project.
 */
import { createServer } from 'node:http';
import { TABLES, USER_ID } from './fixtures.mjs';

const PORT = Number(process.env.MOCK_PORT || 54321);
// PostgREST returns an embedded to-one relation as an object, but returns an
// array when it cannot prove the relationship is to-one. queries.ts defends
// against both via firstOf(); this switch lets us prove both paths render.
const EMBED_AS_ARRAY = process.env.MOCK_EMBED_ARRAY === '1';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeToken(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 3600,
    session_id: 'mock-session',
  };
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.bW9jay1zaWduYXR1cmU`;
}
const userObj = (email) => ({
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email,
  email_confirmed_at: new Date().toISOString(),
  phone: '',
  confirmed_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  is_anonymous: false,
});
const session = (email) => ({
  access_token: makeToken(USER_ID, email),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-refresh-token',
  user: userObj(email),
});

/** `select=a,b,profiles!inner(x,y)` -> { cols:[a,b], embeds:[{table,cols}] } */
function parseSelect(sel) {
  if (!sel) return { cols: null, embeds: [] };
  const cols = [],
    embeds = [];
  let buf = '',
    depth = 0;
  const flush = () => {
    const t = buf.trim();
    buf = '';
    if (!t) return;
    const m = t.match(/^([a-z_]+)(?:!inner|!left)?\((.*)\)$/s);
    if (m)
      embeds.push({
        table: m[1],
        cols: m[2]
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      });
    else cols.push(t);
  };
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return { cols, embeds };
}

const project = (row, cols) =>
  !cols || cols.length === 0 || cols.includes('*')
    ? row
    : Object.fromEntries(cols.map((c) => [c, row[c]]));

function applyFilter(rows, col, spec) {
  const [op, ...rest] = spec.split('.');
  const raw = rest.join('.');
  const val = raw === 'null' ? null : raw;
  const num = (v) => (v === null ? null : isNaN(Number(v)) ? v : Number(v));
  switch (op) {
    case 'eq':
      return rows.filter((r) => String(r[col]) === String(val));
    case 'neq':
      return rows.filter((r) => String(r[col]) !== String(val));
    case 'lt':
      return rows.filter((r) => r[col] < val);
    case 'lte':
      return rows.filter((r) => r[col] <= val);
    case 'gt':
      return rows.filter((r) => r[col] > val);
    case 'gte':
      return rows.filter((r) => r[col] >= val);
    case 'is':
      return rows.filter((r) => (val === null ? r[col] == null : String(r[col]) === String(val)));
    case 'in': {
      const set = raw
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((s) => s.replace(/^"|"$/g, ''));
      return rows.filter((r) => set.includes(String(r[col])));
    }
    default:
      void num;
      return rows;
  }
}

const send = (res, code, body, headers = {}) => {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'content-range',
    ...headers,
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
  });

const log = [];
// Test-visible record of what the app asked for, exposed on /__log.
const recoveryRequests = [];
const passwordUpdates = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  log.push(`${req.method} ${path}${url.search}`);

  if (req.method === 'OPTIONS') return send(res, 204, null);

  // ---- GoTrue ----
  if (path === '/auth/v1/signup') {
    const b = await readBody(req);
    const email = b.email || 'beta@forge.test';
    // Whether signup returns a session depends on the project's "Confirm email"
    // setting, and both answers are real. With confirmation ON, GoTrue creates
    // the user and returns the user object alone — no access_token, so
    // supabase-js reports `session: null`. Address prefix picks which project
    // this run is pretending to be, so one mock covers both.
    if (email.startsWith('needsconfirm')) {
      return send(res, 200, { ...userObj(email), email_confirmed_at: null, confirmed_at: null });
    }
    return send(res, 200, session(email));
  }
  if (path === '/auth/v1/token') {
    const b = await readBody(req);
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      // Mirror GoTrue's real failure shape so the app's error path is exercised.
      if (b.password === 'wrongpassword') {
        return send(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
        });
      }
      return send(res, 200, session(b.email || 'beta@forge.test'));
    }
    return send(res, 200, session('beta@forge.test'));
  }
  if (path === '/auth/v1/user' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer /, '');
    if (!token || token === process.env.MOCK_ANON_KEY) {
      return send(res, 401, { code: 401, msg: 'invalid claim: missing sub claim' });
    }
    try {
      const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (!p.sub) throw new Error('no sub');
      if (p.exp && p.exp * 1000 < Date.now())
        return send(res, 401, { code: 401, msg: 'token expired' });
      return send(res, 200, userObj(p.email || 'beta@forge.test'));
    } catch {
      return send(res, 401, { code: 401, msg: 'invalid JWT' });
    }
  }
  if (path === '/auth/v1/logout') return send(res, 204, null);

  // Password recovery. GoTrue answers 200 whether or not the address exists,
  // which is the behaviour the app relies on to avoid account enumeration —
  // so the stand-in must not be more helpful than the real thing.
  if (path === '/auth/v1/recover') {
    const b = await readBody(req);
    recoveryRequests.push(b.email);
    return send(res, 200, {});
  }

  // updateUser(). Requires a bearer token, exactly as the real endpoint does,
  // so "expired link" is reachable in a test by simply not sending one.
  if (path === '/auth/v1/user' && (req.method === 'PUT' || req.method === 'PATCH')) {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer /, '');
    if (!token || token === process.env.MOCK_ANON_KEY) {
      return send(res, 401, { code: 401, msg: 'invalid claim: missing sub claim' });
    }
    const b = await readBody(req);
    if (b.password) passwordUpdates.push(b.password);
    return send(res, 200, userObj('beta@forge.test'));
  }

  // ---- PostgREST ----
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);
    const base = TABLES[table];
    if (!base)
      return send(res, 404, {
        code: 'PGRST205',
        message: `Could not find the table 'public.${table}'`,
      });

    const { cols, embeds } = parseSelect(url.searchParams.get('select'));

    if (req.method === 'POST') {
      const b = await readBody(req);
      const inserted = (Array.isArray(b) ? b : [b]).map((r) => ({
        id: `99999999-0000-4000-8000-${String(Date.now()).slice(-12)}`,
        user_id: USER_ID,
        created_at: new Date().toISOString(),
        ...r,
      }));
      base.unshift(...inserted);
      const prefer = req.headers.prefer || '';
      if (!prefer.includes('return=representation')) return send(res, 201, null);
      const shaped = inserted.map((r) => project(r, cols));
      // `.single()` sends this Accept header and real PostgREST answers with a
      // bare object; returning an array made supabase-js hand the caller
      // `data.id === undefined` with no error, which looked like an app bug.
      if ((req.headers.accept || '').includes('application/vnd.pgrst.object+json')) {
        return send(res, 201, shaped[0] ?? null);
      }
      return send(res, 201, shaped);
    }
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      let rows = base;
      for (const [k, v] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
        rows = applyFilter(rows, k, v);
      }
      rows.forEach((r) => Object.assign(r, b));
      return send(
        res,
        200,
        rows.map((r) => project(r, cols)),
      );
    }

    let rows = [...base];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      rows = applyFilter(rows, k, v);
    }
    for (const spec of url.searchParams.getAll('order')) {
      const [col, ...mods] = spec.split('.');
      const desc = mods.includes('desc');
      rows.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (desc ? -1 : 1)));
    }
    const limit = url.searchParams.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));

    let out = rows.map((r) => {
      const o = project(r, cols);
      for (const e of embeds) {
        const src = TABLES[e.table] || [];
        const key = e.table === 'profiles' ? 'id' : 'id';
        const match = src.filter((x) => String(x[key]) === String(r.user_id));
        const shaped = match.map((x) => project(x, e.cols));
        o[e.table] = EMBED_AS_ARRAY ? shaped : (shaped[0] ?? null);
      }
      return o;
    });

    // `!inner` drops rows with no match, exactly as PostgREST does.
    if ((url.searchParams.get('select') || '').includes('!inner')) {
      out = out.filter((o) =>
        embeds.every((e) => (EMBED_AS_ARRAY ? o[e.table]?.length : o[e.table])),
      );
    }

    const accept = req.headers.accept || '';
    if (accept.includes('application/vnd.pgrst.object+json')) {
      if (out.length === 0)
        return send(res, 406, {
          code: 'PGRST116',
          details: 'Results contain 0 rows',
          message: 'JSON object requested, multiple (or no) rows returned',
        });
      return send(res, 200, out[0]);
    }
    return send(res, 200, out, {
      'content-range': `0-${Math.max(out.length - 1, 0)}/${out.length}`,
    });
  }

  if (path === '/__log') return send(res, 200, { log, recoveryRequests, passwordUpdates });
  return send(res, 404, { message: 'not found', path });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `mock supabase on http://127.0.0.1:${PORT} (embed as ${EMBED_AS_ARRAY ? 'ARRAY' : 'OBJECT'})`,
  );
});
