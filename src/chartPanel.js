// chartPanel.js — HP-over-time line chart (thin wrapper over Chart.js).
//
// Chart.js is loaded as a global via a CDN <script> in index.html. Points are
// sampled on fixed simulated-time buckets rather than once per rendered frame,
// so the chart looks the same regardless of frame rate or sim speed.

const SAMPLE_EVERY = 0.5; // seconds of sim time between samples

function distinctColors(n) {
  return Array.from({ length: n }, (_, i) =>
    `hsl(${(i * (360 / Math.max(n, 1))) % 360}, 85%, 62%)`);
}

const endLabelPlugin = {
  id: "endLabels",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      const pt = meta.data[meta.data.length - 1];
      const val = ds.data[ds.data.length - 1];
      if (!pt || val == null || val <= 0) return;
      ctx.fillStyle = ds.borderColor;
      ctx.fillText(ds.label, Math.min(pt.x + 6, chartArea.right - 40), pt.y);
    });
    ctx.restore();
  },
};

export class ChartPanel {
  constructor(canvas) {
    this.canvas = canvas;
    this.chart = null;
    this.lastSample = -Infinity;
  }

  reset(sim) {
    const colors = distinctColors(sim.contestants.length);
    const datasets = sim.contestants.map((c, i) => ({
      label: c.name,
      data: [c.hp],
      borderColor: colors[i],
      backgroundColor: colors[i],
      borderWidth: c.controlled ? 3 : 1.5,
      pointRadius: 0,
      tension: 0.25,
    }));
    if (this.chart) this.chart.destroy();
    this.chart = new window.Chart(this.canvas.getContext("2d"), {
      type: "line",
      data: { labels: [0], datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "time (s)", color: "#8b949e" },
               ticks: { color: "#8b949e", maxTicksLimit: 6 }, grid: { color: "#1e2430" } },
          y: { min: 0, max: 100, title: { display: true, text: "HP", color: "#8b949e" },
               ticks: { color: "#8b949e" }, grid: { color: "#1e2430" } },
        },
      },
      plugins: [endLabelPlugin],
    });
    this.lastSample = -Infinity;
    this.sample(sim, true);
  }

  sample(sim, force = false) {
    if (!this.chart) return;
    if (!force && sim.time - this.lastSample < SAMPLE_EVERY) return;
    this.lastSample = sim.time;
    this.chart.data.labels.push(sim.time.toFixed(1));
    sim.contestants.forEach((c, i) => this.chart.data.datasets[i].data.push(Math.max(0, c.hp)));
    this.chart.update("none");
  }
}
