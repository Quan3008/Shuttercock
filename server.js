'use strict';

const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

/* ── Database setup ─────────────────────────────────────────── */
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'shuttletrack.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

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
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(user_phone);
  CREATE INDEX IF NOT EXISTS idx_sessions_date  ON sessions(user_phone, date DESC);

  CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    user_phone  TEXT NOT NULL,
    name        TEXT NOT NULL,
    members     TEXT NOT NULL DEFAULT '[]',
    owner_phone TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_teams_phone ON teams(user_phone);
`);

/* ── Prepared statements ────────────────────────────────────── */
const stmts = {
  findUser:   db.prepare('SELECT * FROM users WHERE phone = ?'),
  upsertUser: db.prepare(`
    INSERT INTO users (id, name, phone, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name
  `),

  getSessions: db.prepare(
    'SELECT * FROM sessions WHERE user_phone = ? ORDER BY date DESC'
  ),
  upsertSession: db.prepare(`
    INSERT INTO sessions
      (id, user_phone, date, shuttle_qty, shuttle_price, court_fee,
       food_cost, total_cost, sport_total, food_total, team_id, players, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date          = excluded.date,
      shuttle_qty   = excluded.shuttle_qty,
      shuttle_price = excluded.shuttle_price,
      court_fee     = excluded.court_fee,
      food_cost     = excluded.food_cost,
      total_cost    = excluded.total_cost,
      sport_total   = excluded.sport_total,
      food_total    = excluded.food_total,
      team_id       = excluded.team_id,
      players       = excluded.players
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),

  getTeams: db.prepare(
    'SELECT * FROM teams WHERE user_phone = ? ORDER BY created_at DESC'
  ),
  upsertTeam: db.prepare(`
    INSERT INTO teams (id, user_phone, name, members, owner_phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name    = excluded.name,
      members = excluded.members
  `),
  deleteTeam: db.prepare('DELETE FROM teams WHERE id = ?')
};

/* ── Row mappers ────────────────────────────────────────────── */
function rowToSession(row) {
  return {
    id:           row.id,
    userPhone:    row.user_phone,
    date:         row.date,
    shuttleQty:   row.shuttle_qty,
    shuttlePrice: row.shuttle_price,
    courtFee:     row.court_fee,
    foodCost:     row.food_cost,
    totalCost:    row.total_cost,
    sportTotal:   row.sport_total,
    foodTotal:    row.food_total,
    teamId:       row.team_id,
    players:      JSON.parse(row.players || '[]'),
    createdAt:    row.created_at
  };
}

function rowToTeam(row) {
  return {
    id:         row.id,
    userPhone:  row.user_phone,
    name:       row.name,
    members:    JSON.parse(row.members || '[]'),
    ownerPhone: row.owner_phone,
    createdAt:  row.created_at
  };
}

/* ── Middleware ─────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── API: Users ─────────────────────────────────────────────── */
app.post('/api/users/find', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const user = stmts.findUser.get(phone.trim());
    res.json(user || null);
  } catch (e) {
    console.error('findUser:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users', (req, res) => {
  try {
    const { id, name, phone, createdAt } = req.body;
    if (!id || !name || !phone) return res.status(400).json({ error: 'id, name, phone required' });
    stmts.upsertUser.run(id, name, phone.trim(), createdAt || new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('saveUser:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── API: Sessions ──────────────────────────────────────────── */
app.get('/api/sessions/:phone', (req, res) => {
  try {
    const rows = stmts.getSessions.all(decodeURIComponent(req.params.phone));
    res.json(rows.map(rowToSession));
  } catch (e) {
    console.error('getSessions:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions', (req, res) => {
  try {
    const s = req.body;
    if (!s.id || !s.userPhone) return res.status(400).json({ error: 'id and userPhone required' });
    stmts.upsertSession.run(
      s.id, s.userPhone, s.date || '',
      s.shuttleQty || 0, s.shuttlePrice || 0,
      s.courtFee   || 0, s.foodCost    || 0,
      s.totalCost  || 0, s.sportTotal  || 0, s.foodTotal || 0,
      s.teamId     || '',
      JSON.stringify(s.players || []),
      s.createdAt  || new Date().toISOString()
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('saveSession:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    stmts.deleteSession.run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteSession:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── API: Teams ─────────────────────────────────────────────── */
app.get('/api/teams/:phone', (req, res) => {
  try {
    const rows = stmts.getTeams.all(decodeURIComponent(req.params.phone));
    res.json(rows.map(rowToTeam));
  } catch (e) {
    console.error('getTeams:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/teams', (req, res) => {
  try {
    const t = req.body;
    if (!t.id || !t.userPhone) return res.status(400).json({ error: 'id and userPhone required' });
    stmts.upsertTeam.run(
      t.id, t.userPhone, t.name || '',
      JSON.stringify(t.members || []),
      t.ownerPhone || t.userPhone || '',
      t.createdAt  || new Date().toISOString()
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('saveTeam:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    stmts.deleteTeam.run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteTeam:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── Health check ───────────────────────────────────────────── */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/* ── SPA fallback ───────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── Start ──────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  console.log(`\n🏸 ShuttleTrack server running`);
  console.log(`   → http://localhost:${PORT}\n`);
});

process.on('SIGINT',  () => { db.close(); server.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); server.close(); process.exit(0); });
