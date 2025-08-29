// server.js
// Local ingestion server + dashboard + SQLite storage.

const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'db');
const DB_PATH = path.join(DB_DIR, 'data.sqlite');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// create tables
db.exec(`
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId TEXT,
  zoneId TEXT,
  floor INTEGER,
  temp REAL,
  humidity REAL,
  co2 REAL,
  occupancy INTEGER,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zoneId TEXT,
  floor INTEGER,
  type TEXT,
  message TEXT,
  ts INTEGER
);
`);

const insertStmt = db.prepare(`
INSERT INTO readings (deviceId, zoneId, floor, temp, humidity, co2, occupancy, ts)
VALUES (@deviceId,@zoneId,@floor,@temp,@humidity,@co2,@occupancy,@ts)
`);

// smoothing window (server-side backup)
const WINDOW_SIZE = 6;
const zoneBuffers = new Map();

function pushToBuffer(zoneId, floor, metric, value) {
  if (!zoneBuffers.has(zoneId)) zoneBuffers.set(zoneId, { temp:[], humidity:[], co2:[], occupancy:[], floor });
  const buf = zoneBuffers.get(zoneId);
  buf[metric].push(value);
  if (buf[metric].length > WINDOW_SIZE) buf[metric].shift();
}
function avg(arr){ if (!arr.length) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname,'public')));

const server = http.createServer(app);
const io = new Server(server);

// health
app.get('/api/health', (req,res) => res.json({ ok:true, ts:Date.now() }));

// ingestion endpoint
// accepts payload: { deviceId, zoneId, floor, temp, humidity, co2, occupancy, ts }
app.post('/api/ingest', (req,res) => {
  try {
    const p = req.body;
    if (!p || !p.deviceId || !p.zoneId || typeof p.temp === 'undefined') {
      return res.status(400).json({ error: 'invalid payload' });
    }
    p.ts = p.ts || Date.now();

    insertStmt.run({
      deviceId: p.deviceId,
      zoneId: p.zoneId,
      floor: p.floor || 0,
      temp: p.temp,
      humidity: p.humidity,
      co2: p.co2,
      occupancy: p.occupancy || 0,
      ts: p.ts
    });

    pushToBuffer(p.zoneId, p.floor, 'temp', p.temp);
    pushToBuffer(p.zoneId, p.floor, 'humidity', p.humidity);
    pushToBuffer(p.zoneId, p.floor, 'co2', p.co2);
    pushToBuffer(p.zoneId, p.floor, 'occupancy', p.occupancy || 0);

    const buf = zoneBuffers.get(p.zoneId);
    const payload = {
      zoneId: p.zoneId,
      floor: buf.floor,
      avgTemp: +(avg(buf.temp) || 0).toFixed(2),
      avgHumidity: +(avg(buf.humidity) || 0).toFixed(2),
      avgCO2: +(avg(buf.co2) || 0).toFixed(0),
      occupancy: Math.round(avg(buf.occupancy) || 0),
      ts: Date.now()
    };

    io.emit('zone_update', payload);

    // alert rule example
    if (payload.avgCO2 > 1000) {
      const alertMsg = `High CO2 in ${p.zoneId}: ${payload.avgCO2} ppm`;
      db.prepare(`INSERT INTO alerts (zoneId,floor,type,message,ts) VALUES (?,?,?,?,?)`)
        .run(p.zoneId, p.floor || 0, 'co2', alertMsg, Date.now());
      io.emit('alert', { zoneId: p.zoneId, floor: p.floor, type: 'co2', message: alertMsg, ts: Date.now() });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('ingest error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// dashboard initial summary
app.get('/api/summary', (req,res) => {
  try {
    const rows = db.prepare(`
      SELECT zoneId, floor, temp, humidity, co2, occupancy, ts
      FROM readings
      WHERE ts >= ?
      ORDER BY ts DESC
    `).all(Date.now() - 1000*60*60*24); // last 24 hours

    const latest = {};
    for (const r of rows) {
      if (!latest[r.zoneId]) latest[r.zoneId] = r;
    }
    const summary = Object.values(latest).map(r=>({
      zoneId: r.zoneId, floor: r.floor, temp: r.temp, humidity: r.humidity, co2: r.co2, occupancy: r.occupancy, ts: r.ts
    }));
    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

io.on('connection', (socket) => {
  console.log('dashboard client connected', socket.id);
  socket.on('disconnect', () => console.log('client disconnected', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
