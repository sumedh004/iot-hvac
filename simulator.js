// simulator.js
// Simulate many devices and post to either gateway or server directly.

const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const building = require('./config/building.json');

const argv = yargs(hideBin(process.argv))
  .option('target', { type: 'string', default: 'http://localhost:3000/api/ingest', description: 'ingest endpoint or gateway' })
  .option('interval', { type: 'number', default: 5000 })
  .option('jitter', { type: 'number', default: 1000 })
  .argv;

const TARGET = argv.target.replace(/\/$/, '');
const BASE_INTERVAL = argv.interval;

function randRange(min, max) { return Math.random() * (max - min) + min; }

function makeDevicesFromBuilding(buildingConfig) {
  const devices = [];
  for (const floor of buildingConfig.floors) {
    const fnum = floor.floor;
    for (const r of floor.rooms) devices.push({ deviceId: `dev-${fnum}-${r}`, zoneId: r, floor: fnum, kind: 'room' });
    for (const h of floor.hallways) devices.push({ deviceId: `dev-${fnum}-${h}`, zoneId: h, floor: fnum, kind: 'hallway' });
  }
  return devices;
}

const devices = makeDevicesFromBuilding(building);

const baselines = {};
for (const f of building.floors) {
  baselines[f.floor] = {
    temp: randRange(20,24),
    humidity: randRange(35,50),
    co2: randRange(450,600),
    occupancyProb: 0.4
  };
}

const deviceState = {};
for (const d of devices) {
  const b = baselines[d.floor];
  deviceState[d.deviceId] = {
    temp: b.temp + randRange(-1,1),
    humidity: b.humidity + randRange(-3,3),
    co2: b.co2 + randRange(-50,50),
    occupancy: Math.random() < b.occupancyProb ? Math.round(randRange(1,6)) : 0
  };
}

async function sendReading(device, state) {
  const payload = {
    deviceId: device.deviceId,
    zoneId: device.zoneId,
    floor: device.floor,
    temp: +(state.temp).toFixed(2),
    humidity: +(state.humidity).toFixed(1),
    co2: Math.round(state.co2),
    occupancy: Math.round(state.occupancy),
    ts: Date.now()
  };
  try {
    await axios.post(TARGET, payload, { timeout: 3000 });
  } catch (err) {
  console.error(`[${device.deviceId}] send error: ${err.code || err.message}`);
  }
}

for (const d of devices) {
  (function loop(dev) {
    const jitter = Math.random() * argv.jitter;
    const interval = BASE_INTERVAL + jitter;
    setInterval(async () => {
      const s = deviceState[dev.deviceId];
      s.temp += randRange(-0.25, 0.25);
      s.humidity += randRange(-0.5, 0.5);
      s.co2 += randRange(-10, 10);
      if (Math.random() < 0.05) s.occupancy = Math.max(0, s.occupancy + Math.round(randRange(-1,1)));
      if (Math.random() < 0.01) s.co2 += randRange(200,600); // event spike
      await sendReading(dev, s);
    }, interval);
  })(d);
}

console.log(`Simulating ${devices.length} devices. Posting to ${TARGET} every ~${BASE_INTERVAL}ms per device.`);
