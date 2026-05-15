'use strict';

const express = require('express');
const { neon } = require('@neondatabase/serverless');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Lazy DB init (no crash on startup) ─────────────────────── */
let _sql = null;
function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Add a Postgres database in Vercel Dashboard → Storage.');
    _sql = neon(url);
  }
  return _sql;
}

let _tablesReady = false;
async function ensureTables() {
  if (_tablesReady) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      phone      TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      user_phone    TEXT NOT NULL,
      date          TEXT NOT NULL,
      shuttle_qty   REAL NOT NULL DEFAULT 0,
      shuttle_price REAL NOT NULL DEFAULT 0,
      court_fee     REAL NOT NULL DEFAULT 0,
      food_cost     REAL NOT NULL DEFAULT 0,
      total_cost    REAL NOT NULL DEFAULT 0,
      sport_total   REAL NOT NULL DEFAULT 0,
      food_total    REAL NOT NULL DEFAULT 0,
      team_id       TEXT NOT NULL DEFAULT '',
      players       TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(user_phone)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_date  ON sessions(user_phone, date DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      user_phone  TEXT NOT NULL,
      name        TEXT NOT NULL,
      members     TEXT NOT NULL DEFAULT '[]',
      owner_phone TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_teams_phone ON teams(user_phone)`;
  _tablesReady = true;
  console.log('✅ Tables ready');
}

/* ── Row mappers ────────────────────────────────────────────── */
function rowToSession(r) {
  return {
    id:           r.id,
    userPhone:    r.user_phone,
    date:         r.date,
    shuttleQty:   parseFloat(r.shuttle_qty)   || 0,
    shuttlePrice: parseFloat(r.shuttle_price) || 0,
    courtFee:     parseFloat(r.court_fee)     || 0,
    foodCost:     parseFloat(r.food_cost)     || 0,
    totalCost:    parseFloat(r.total_cost)    || 0,
    sportTotal:   parseFloat(r.sport_total)   || 0,
    foodTotal:    parseFloat(r.food_total)    || 0,
    teamId:       r.team_id,
    players:      typeof r.players === 'string' ? JSON.parse(r.players) : (r.players || []),
    createdAt:    r.created_at
  };
}

function rowToTeam(r) {
  return {
    id:         r.id,
    userPhone:  r.user_phone,
    name:       r.name,
    members:    typeof r.members === 'string' ? JSON.parse(r.members) : (r.members || []),
    ownerPhone: r.owner_phone,
    createdAt:  r.created_at
  };
}

/* ── Middleware ─────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure tables exist before any API call (lazy, once per cold start)
app.use('/api', async (req, res, next) => {
  try {
    await ensureTables();
    next();
  } catch (e) {
    console.error('DB init error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── API: Users ─────────────────────────────────────────────── */
app.post('/api/users/find', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const sql = getSql();
    const rows = await sql`SELECT * FROM users WHERE phone = ${phone.trim()}`;
    res.json(rows[0] || null);
  } catch (e) { console.error('findUser:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { id, name, phone, createdAt } = req.body;
    if (!id || !name || !phone) return res.status(400).json({ error: 'id, name, phone required' });
    const sql = getSql();
    await sql`
      INSERT INTO users (id, name, phone, created_at)
      VALUES (${id}, ${name}, ${phone.trim()}, ${createdAt || new Date().toISOString()})
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name`;
    res.json({ ok: true });
  } catch (e) { console.error('saveUser:', e.message); res.status(500).json({ error: e.message }); }
});

/* ── API: Sessions ──────────────────────────────────────────── */
app.get('/api/sessions/:phone', async (req, res) => {
  try {
    const sql = getSql();
    const phone = decodeURIComponent(req.params.phone);
    const rows = await sql`SELECT * FROM sessions WHERE user_phone = ${phone} ORDER BY date DESC`;
    res.json(rows.map(rowToSession));
  } catch (e) { console.error('getSessions:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const s = req.body;
    if (!s.id || !s.userPhone) return res.status(400).json({ error: 'id and userPhone required' });
    const sql = getSql();
    await sql`
      INSERT INTO sessions
        (id, user_phone, date, shuttle_qty, shuttle_price, court_fee,
         food_cost, total_cost, sport_total, food_total, team_id, players, created_at)
      VALUES (
        ${s.id}, ${s.userPhone}, ${s.date || ''},
        ${s.shuttleQty || 0}, ${s.shuttlePrice || 0},
        ${s.courtFee || 0}, ${s.foodCost || 0},
        ${s.totalCost || 0}, ${s.sportTotal || 0}, ${s.foodTotal || 0},
        ${s.teamId || ''}, ${JSON.stringify(s.players || [])},
        ${s.createdAt || new Date().toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        date = EXCLUDED.date, shuttle_qty = EXCLUDED.shuttle_qty,
        shuttle_price = EXCLUDED.shuttle_price, court_fee = EXCLUDED.court_fee,
        food_cost = EXCLUDED.food_cost, total_cost = EXCLUDED.total_cost,
        sport_total = EXCLUDED.sport_total, food_total = EXCLUDED.food_total,
        team_id = EXCLUDED.team_id, players = EXCLUDED.players`;
    res.json({ ok: true });
  } catch (e) { console.error('saveSession:', e.message); res.status(500).json({ error: e.message }); }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const sql = getSql();
    await sql`DELETE FROM sessions WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (e) { console.error('deleteSession:', e.message); res.status(500).json({ error: e.message }); }
});

/* ── API: Teams ─────────────────────────────────────────────── */
app.get('/api/teams/:phone', async (req, res) => {
  try {
    const sql = getSql();
    const phone = decodeURIComponent(req.params.phone);
    const rows = await sql`SELECT * FROM teams WHERE user_phone = ${phone} ORDER BY created_at DESC`;
    res.json(rows.map(rowToTeam));
  } catch (e) { console.error('getTeams:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/teams', async (req, res) => {
  try {
    const t = req.body;
    if (!t.id || !t.userPhone) return res.status(400).json({ error: 'id and userPhone required' });
    const sql = getSql();
    await sql`
      INSERT INTO teams (id, user_phone, name, members, owner_phone, created_at)
      VALUES (
        ${t.id}, ${t.userPhone}, ${t.name || ''},
        ${JSON.stringify(t.members || [])},
        ${t.ownerPhone || t.userPhone || ''},
        ${t.createdAt || new Date().toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, members = EXCLUDED.members`;
    res.json({ ok: true });
  } catch (e) { console.error('saveTeam:', e.message); res.status(500).json({ error: e.message }); }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const sql = getSql();
    await sql`DELETE FROM teams WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (e) { console.error('deleteTeam:', e.message); res.status(500).json({ error: e.message }); }
});

/* ── Health check ───────────────────────────────────────────── */
app.get('/api/health', async (_req, res) => {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    res.json({ status: 'ok', db: 'neon-postgres', ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

/* ── SPA fallback ───────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── Start (local dev only) ─────────────────────────────────── */
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`\n🏸 ShuttleTrack → http://localhost:${PORT}\n`));
}

module.exports = app;
