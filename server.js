'use strict';

const express = require('express');
const { Pool }  = require('pg');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── PostgreSQL connection pool ─────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

/* ── Create tables on first boot ────────────────────────────── */
async function initDB() {
  await pool.query(`
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
  console.log('✅ Database tables ready.');
}

/* ── Row mappers ────────────────────────────────────────────── */
function rowToSession(row) {
  return {
    id:           row.id,
    userPhone:    row.user_phone,
    date:         row.date,
    shuttleQty:   parseFloat(row.shuttle_qty)   || 0,
    shuttlePrice: parseFloat(row.shuttle_price) || 0,
    courtFee:     parseFloat(row.court_fee)     || 0,
    foodCost:     parseFloat(row.food_cost)     || 0,
    totalCost:    parseFloat(row.total_cost)    || 0,
    sportTotal:   parseFloat(row.sport_total)   || 0,
    foodTotal:    parseFloat(row.food_total)    || 0,
    teamId:       row.team_id,
    players:      typeof row.players === 'string' ? JSON.parse(row.players) : (row.players || []),
    createdAt:    row.created_at
  };
}

function rowToTeam(row) {
  return {
    id:         row.id,
    userPhone:  row.user_phone,
    name:       row.name,
    members:    typeof row.members === 'string' ? JSON.parse(row.members) : (row.members || []),
    ownerPhone: row.owner_phone,
    createdAt:  row.created_at
  };
}

/* ── Middleware ─────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── API: Users ─────────────────────────────────────────────── */
app.post('/api/users/find', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone = $1', [phone.trim()]
    );
    res.json(rows[0] || null);
  } catch (e) {
    console.error('findUser:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { id, name, phone, createdAt } = req.body;
    if (!id || !name || !phone) return res.status(400).json({ error: 'id, name, phone required' });
    await pool.query(`
      INSERT INTO users (id, name, phone, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
    `, [id, name, phone.trim(), createdAt || new Date().toISOString()]);
    res.json({ ok: true });
  } catch (e) {
    console.error('saveUser:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── API: Sessions ──────────────────────────────────────────── */
app.get('/api/sessions/:phone', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sessions WHERE user_phone = $1 ORDER BY date DESC',
      [decodeURIComponent(req.params.phone)]
    );
    res.json(rows.map(rowToSession));
  } catch (e) {
    console.error('getSessions:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const s = req.body;
    if (!s.id || !s.userPhone) return res.status(400).json({ error: 'id and userPhone required' });
    await pool.query(`
      INSERT INTO sessions
        (id, user_phone, date, shuttle_qty, shuttle_price, court_fee,
         food_cost, total_cost, sport_total, food_total, team_id, players, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        date          = EXCLUDED.date,
        shuttle_qty   = EXCLUDED.shuttle_qty,
        shuttle_price = EXCLUDED.shuttle_price,
        court_fee     = EXCLUDED.court_fee,
        food_cost     = EXCLUDED.food_cost,
        total_cost    = EXCLUDED.total_cost,
        sport_total   = EXCLUDED.sport_total,
        food_total    = EXCLUDED.food_total,
        team_id       = EXCLUDED.team_id,
        players       = EXCLUDED.players
    `, [
      s.id, s.userPhone, s.date || '',
      s.shuttleQty || 0, s.shuttlePrice || 0,
      s.courtFee   || 0, s.foodCost    || 0,
      s.totalCost  || 0, s.sportTotal  || 0, s.foodTotal || 0,
      s.teamId     || '',
      JSON.stringify(s.players || []),
      s.createdAt  || new Date().toISOString()
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('saveSession:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteSession:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── API: Teams ─────────────────────────────────────────────── */
app.get('/api/teams/:phone', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM teams WHERE user_phone = $1 ORDER BY created_at DESC',
      [decodeURIComponent(req.params.phone)]
    );
    res.json(rows.map(rowToTeam));
  } catch (e) {
    console.error('getTeams:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const t = req.body;
    if (!t.id || !t.userPhone) return res.status(400).json({ error: 'id and userPhone required' });
    await pool.query(`
      INSERT INTO teams (id, user_phone, name, members, owner_phone, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        name    = EXCLUDED.name,
        members = EXCLUDED.members
    `, [
      t.id, t.userPhone, t.name || '',
      JSON.stringify(t.members || []),
      t.ownerPhone || t.userPhone || '',
      t.createdAt  || new Date().toISOString()
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('saveTeam:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteTeam:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── Health check ───────────────────────────────────────────── */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'postgres', ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

/* ── SPA fallback ───────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── Boot ───────────────────────────────────────────────────── */
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🏸 ShuttleTrack server running → http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  });

module.exports = app; // required by Vercel
