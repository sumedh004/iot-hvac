// public/client.js
(async () => {
  const socket = io();

  const zonesDiv = document.getElementById('zones');
  const alertsDiv = document.getElementById('alerts');
  const zoneWidgets = {};

  function makeZoneCard(zone) {
    const el = document.createElement('div');
    el.className = 'zone';
    el.id = 'zone-' + zone.zoneId;
    el.innerHTML = `
      <h4>${zone.zoneId} (Floor ${zone.floor})</h4>
      <div>Temp: <span class="temp">-</span> °C</div>
      <div>Humidity: <span class="humidity">-</span> %</div>
      <div>CO2: <span class="co2">-</span> ppm</div>
      <div>Occupancy: <span class="occupancy">-</span></div>
      <canvas id="chart-${zone.zoneId}" width="280" height="120"></canvas>
    `;
    zonesDiv.appendChild(el);

    const ctx = el.querySelector('canvas').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Temp (C)', data: [], tension: 0.3, yAxisID: 'y' },
          { label: 'CO2 (ppm)', data: [], tension: 0.3, yAxisID: 'y1' }
        ]
      },
      options: { responsive: false, scales: { y: { position: 'left' }, y1: { position: 'right' } } }
    });

    zoneWidgets[zone.zoneId] = { el, chart };
  }

  async function loadSummary() {
    const res = await fetch('/api/summary');
    const data = await res.json();
    zonesDiv.innerHTML = '';
    data.summary.forEach(z => {
      makeZoneCard(z);
      updateZoneDisplay({
        zoneId: z.zoneId,
        floor: z.floor,
        avgTemp: z.temp,
        avgHumidity: z.humidity,
        avgCO2: z.co2,
        occupancy: z.occupancy,
        ts: z.ts
      });
    });
  }

  function updateZoneDisplay(payload) {
    const zoneId = payload.zoneId;
    if (!zoneWidgets[zoneId]) makeZoneCard({ zoneId, floor: payload.floor || 0 });
    const w = zoneWidgets[zoneId];
    const el = w.el;
    el.querySelector('.temp').innerText = payload.avgTemp;
    el.querySelector('.humidity').innerText = payload.avgHumidity;
    el.querySelector('.co2').innerText = payload.avgCO2;
    el.querySelector('.occupancy').innerText = payload.occupancy;

    const ch = w.chart;
    const label = new Date(payload.ts).toLocaleTimeString();
    ch.data.labels.push(label);
    ch.data.datasets[0].data.push(payload.avgTemp);
    ch.data.datasets[1].data.push(payload.avgCO2);
    if (ch.data.labels.length > 20) {
      ch.data.labels.shift();
      ch.data.datasets.forEach(ds => ds.data.shift());
    }
    ch.update();
  }

  socket.on('zone_update', (p) => updateZoneDisplay(p));
  socket.on('alert', (a) => {
    const d = document.createElement('div');
    d.className = 'alert';
    d.innerText = `[${new Date(a.ts).toLocaleTimeString()}] ALERT ${a.zoneId} - ${a.message}`;
    alertsDiv.prepend(d);
  });

  // initial load
  loadSummary();
})();
