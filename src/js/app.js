import * as d3 from "d3";
import Papa from "papaparse";

// Static CSV files hosted in the WordPress media library.
const DATA_URLS = {
  returns:
    "https://capitalogic.co/wp-content/uploads/2025/09/Asset_Returns.csv",
  vols:
    "https://capitalogic.co/wp-content/uploads/2025/09/Asset_Volatilities.csv",
  corr:
    "https://capitalogic.co/wp-content/uploads/2025/09/Asset_Correlations.csv",
};

async function fetchCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: false, dynamicTyping: true });
  return parsed.data;
}

async function loadStaticData() {
  const [retRows, volRows, corrRows] = await Promise.all([
    fetchCsv(DATA_URLS.returns),
    fetchCsv(DATA_URLS.vols),
    fetchCsv(DATA_URLS.corr),
  ]);

  const assets = retRows.slice(1).map(r => String(r[0]));
  const meanReturns = retRows.slice(1).map(r => Number(r[1]));
  const vols = volRows.slice(1).map(r => Number(r[1]));
  const corr = corrRows.slice(1).map(row => row.slice(1).map(Number));
  console.log("Loaded data:", assets.length, meanReturns.length, vols.length, corr.length);
  return { assets, meanReturns, vols, corr };
}

/**
 * Web MVP of your PyQt5 app:
 * - Loads CSVs from the WordPress media library
 * - Compute random portfolios (approximate frontier), MVP, Max-Sharpe
 * - Add user portfolio by weights and custom R/V points
 * - Draw interactive scatter + frontier line
 */

// ---- Utilities --------------------------------------------------------------
const pct = (x) => (x * 100).toFixed(2) + "%";
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

function portfolioVol(weights, cov) {
  // sqrt( w^T * C * w )
  const n = weights.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) acc += weights[i] * cov[i][j] * weights[j];
  }
  return Math.sqrt(acc);
}

function normalizeWeights(w) {
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}

function computeCov(vols, corr) {
  const n = vols.length;
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) cov[i][j] = vols[i] * vols[j] * corr[i][j];
  }
  return cov;
}

function estimateFrontierFromCloud(points) {
  // Compute an upper envelope (max return for each vol) by binning vols
  const bins = 120;
  const minV = d3.min(points, (d) => d.vol);
  const maxV = d3.max(points, (d) => d.vol);
  const step = (maxV - minV) / bins;
  const frontier = [];
  for (let b = 0; b <= bins; b++) {
    const v0 = minV + b * step;
    const v1 = v0 + step;
    const bucket = points.filter((d) => d.vol >= v0 && d.vol < v1);
    if (!bucket.length) continue;
    const best = d3.max(bucket, (d) => d.ret);
    const winner = bucket.find((d) => d.ret === best);
    frontier.push(winner);
  }
  // smooth a little
  return frontier.sort((a, b) => a.vol - b.vol);
}

function findMinVariance(points) {
  return points.reduce((best, d) => (d.vol < best.vol ? d : best), points[0]);
}

function findMaxSharpe(points, rf) {
  return points.reduce((best, d) => {
    const s = (d.ret - rf) / d.vol;
    const sb = (best.ret - rf) / best.vol;
    return s > sb ? d : best;
  }, points[0]);
}

// ---- State ------------------------------------------------------------------
const state = {
  assets: [],
  meanReturns: [], // decimals
  vols: [],        // decimals
  corr: [],        // 2D
  cov: [],         // 2D
  rf: 0,           // decimal
  cloud: [],       // random portfolios
  userWeightPoints: [],
  userRVPoints: []
};

// ---- DOM hookup -------------------------------------------------------------
function qs(sel){ return document.querySelector(sel); }

function setup() {
  // wire inputs
  const runBtn = qs("#ef-run");
  const eqBtn = qs("#ef-eq");
  const addWeightsBtn = qs("#ef-add-weights");
  const clearWeightsBtn = qs("#ef-clear-weights");
  const addRVBtn = qs("#ef-add-rv");
  const clearRVBtn = qs("#ef-clear-rv");

  // Equal-weight helper
  eqBtn.addEventListener("click", () => {
    const wrap = qs("#ef-weights");
    wrap.querySelectorAll("input[type=number]").forEach((el) => el.remove());
    wrap.querySelectorAll("label").forEach((el) => el.remove());
    if (!state.assets.length) return;
    const w = 100 / state.assets.length;
    state.assets.forEach((name, i) => {
      const label = document.createElement("label");
      label.textContent = `${name} (%)`;
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = 0; inp.max = 100; inp.step = "0.01";
      inp.value = w.toFixed(2);
      inp.dataset.idx = i;
      wrap.appendChild(label); wrap.appendChild(inp);
    });
  });

  runBtn.addEventListener("click", async () => {
    try {
      const { assets, meanReturns, vols, corr } = await loadStaticData();
      state.assets = assets;
      state.meanReturns = meanReturns;
      state.vols = vols;
      state.corr = corr;
      state.cov = computeCov(vols, corr);
      state.rf = clamp(Number(qs("#ef-rf").value) / 100, 0, 1);
      const sims = clamp(parseInt(qs("#ef-sims").value || "50000", 10), 1000, 200000);

      // generate cloud exactly as before...
      const cloud = [];
      for (let i = 0; i < sims; i++) {
        let w = Array.from({ length: assets.length }, () => Math.random());
        w = normalizeWeights(w);
        const ret = dot(w, meanReturns);
        const vol = portfolioVol(w, state.cov);
        const sharpe = (ret - state.rf) / vol;
        cloud.push({ ret, vol, sharpe, w });
      }
      state.cloud = cloud;

      draw();
      if (!qs("#ef-weights input")) qs("#ef-eq").click();
    } catch (err) {
      console.error(err);
      alert("Failed to load sample data");
    }
  });

  addWeightsBtn.addEventListener("click", () => {
    if (!state.assets.length) return alert("Load data first.");
    const wrap = qs("#ef-weights");
    const inputs = [...wrap.querySelectorAll("input[type=number]")];
    if (!inputs.length) return alert("No weight inputs.");
    let w = inputs.map(inp => Number(inp.value || "0") / 100);
    const sum = w.reduce((a,b)=>a+b,0);
    if (Math.abs(sum - 1) > 1e-6) return alert("Weights must sum to 100%.");
    const ret = dot(w, state.meanReturns);
    const vol = portfolioVol(w, state.cov);
    state.userWeightPoints.push({ ret, vol, w });
    draw();
  });

  clearWeightsBtn.addEventListener("click", () => {
    state.userWeightPoints = [];
    draw();
  });

  addRVBtn.addEventListener("click", () => {
    const r = Number(qs("#ef-rv-ret").value)/100;
    const v = Number(qs("#ef-rv-vol").value)/100;
    if (isNaN(r) || isNaN(v)) return alert("Enter both return and volatility.");
    state.userRVPoints.push({ ret: r, vol: v });
    draw();
  });

  clearRVBtn.addEventListener("click", () => {
    state.userRVPoints = [];
    draw();
  });
}

function draw() {
  const mount = qs("#ef-chart");
  mount.innerHTML = "";

  if (!state.cloud.length) return;

  const width = mount.clientWidth || 800;
  const height = 520;

  const svg = d3.select(mount).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(state.cloud, d => d.vol) * 1.1])
    .range([60, width - 20]);

  const y = d3.scaleLinear()
    .domain([d3.min(state.cloud, d => d.ret) * 0.9, d3.max(state.cloud, d => d.ret) * 1.1])
    .range([height - 50, 20]);

  // Random portfolios cloud
  const color = d3.scaleSequential(d3.interpolateViridis)
    .domain(d3.extent(state.cloud, d => d.sharpe));

  svg.append("g")
    .selectAll("circle")
    .data(state.cloud)
    .join("circle")
    .attr("cx", d => x(d.vol))
    .attr("cy", d => y(d.ret))
    .attr("r", 2)
    .attr("fill", d => color(d.sharpe))
    .attr("opacity", 0.5);

  // Frontier (estimated)
  const frontier = estimateFrontierFromCloud(state.cloud);
  const line = d3.line().x(d => x(d.vol)).y(d => y(d.ret));
  svg.append("path")
    .attr("d", line(frontier))
    .attr("stroke", "#111")
    .attr("fill", "none")
    .attr("stroke-width", 2);

  // MVP + Max Sharpe
  const mvp = findMinVariance(frontier);
  const maxSharpe = findMaxSharpe(state.cloud, state.rf);

  const mark = (d, label, cls) => {
    svg.append("circle").attr("cx", x(d.vol)).attr("cy", y(d.ret)).attr("r", 5).attr("fill", cls);
    svg.append("text").attr("x", x(d.vol)+8).attr("y", y(d.ret)-8).text(label).attr("font-size", 12);
  };
  mark(mvp, "Min Variance", "#ef4444");
  mark(maxSharpe, "Max Sharpe", "#2563eb");

  // User weight points
  svg.append("g")
    .selectAll("circle.uf")
    .data(state.userWeightPoints)
    .join("circle")
    .attr("class", "uf")
    .attr("cx", d => x(d.vol)).attr("cy", d => y(d.ret))
    .attr("r", 5).attr("fill", "#dc2626");

  // User R/V points
  svg.append("g")
    .selectAll("path.rv")
    .data(state.userRVPoints)
    .join("path")
    .attr("class", "rv")
    .attr("transform", d => `translate(${x(d.vol)},${y(d.ret)})`)
    .attr("d", d3.symbol().type(d3.symbolTriangle).size(80))
    .attr("fill", "#1d4ed8");

  // Axes
  const xAxis = d3.axisBottom(x).tickFormat((v)=> (v*100).toFixed(1)+"%");
  const yAxis = d3.axisLeft(y).tickFormat((v)=> (v*100).toFixed(1)+"%");
  svg.append("g").attr("transform", `translate(0,${height-50})`).call(xAxis);
  svg.append("g").attr("transform", `translate(60,0)`).call(yAxis);
  svg.append("text").attr("x", width/2).attr("y", height-10).attr("text-anchor","middle").text("Volatility (σ)");
  svg.append("text").attr("x", -height/2).attr("y", 15).attr("transform","rotate(-90)").attr("text-anchor","middle").text("Expected Return");
}

document.addEventListener("DOMContentLoaded", setup);
