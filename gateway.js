// gateway.js
// Optional local gateway that receives simulator posts,
// applies edge filtering and threshold checks,
// then forwards cleaned events to the local server ingestion endpoint.

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('port', { type: 'number', default: 4000 })
  .option('forward', { type: 'string', default: 'http://localhost:3000/api/ingest' })
  .argv;

const app = express();
app.use(bodyParser.json());

const WINDOW_SIZE = 4;
const zoneBuffers = new Map();

function pushToBuf(zoneId, metric, v) {
  if (!zoneBuffers.has(zoneId)) zoneBuffers.set(zoneId, { temp:[], humidity:[], co2:[], occupancy:[] });
  const buf = zoneBuffers.get(zoneId);
  buf[metric].push(v);
  if (buf[metric].length > WINDOW_SIZE) buf[metric].shift();
}
function avg(arr){ if (!arr.length) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }

app.post('/gateway/ingest', async (req,res) => {
  try {
    const p = req.body;
    p.ts = p.ts || Date.now();
    // push raw into buffers
    pushToBuf(p.zoneId, 'temp', p.temp);
    pushToBuf(p.zoneId, 'humidity', p.humidity);
    pushToBuf(p.zoneId, 'co2', p.co2);
    pushToBuf(p.zoneId, 'occupancy', p.occupancy || 0);

    // create smoothed payload
    const buf = zoneBuffers.get(p.zoneId);
    const out = {
      deviceId: p.deviceId,
      zoneId: p.zoneId,
      floor: p.floor,
      temp: +(avg(buf.temp) || p.temp).toFixed(2),
      humidity: +(avg(buf.humidity) || p.humidity).toFixed(2),
      co2: Math.round(avg(buf.co2) || p.co2),
      occupancy: Math.round(avg(buf.occupancy) || p.occupancy || 0),
      ts: p.ts
    };

    // simple threshold filtering at edge: drop extremely invalid values
    if (out.temp < -10 || out.temp > 60 || out.co2 < 0 || out.co2 > 50000) {
      return res.status(400).json({ error: 'invalid reading at gateway' });
    }

    // forward to server ingestion
    await axios.post(argv.forward, out, { timeout: 5000 }).catch(e => {
      console.error('forward error', e.message);
    });

    res.json({ ok: true, forwarded: true });
  } catch (err) {
    console.error('gateway error', err);
    res.status(500).json({ error: 'gateway error' });
  }
});

const PORT = argv.port;
app.listen(PORT, () => console.log(`Gateway listening on http://localhost:${PORT}/gateway/ingest forwarding to ${argv.forward}`));
