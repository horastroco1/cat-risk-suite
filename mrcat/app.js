/**
 * CAT Risk Suite — client
 * Expects Netlify redirects: /api/* → functions
 */
const API = "";

const state = {
  lastRun: null,
  prevRunId: null,
  briefingMarkdown: "",
  portfolio: [],
  perilFilter: null,
};

function $(id) {
  return document.getElementById(id);
}

async function api(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data.error || data.message || res.statusText);
  return data;
}

function setTrustRibbon(run) {
  const el = $("trust-feeds");
  if (!el) return;
  if (!run || !run.feed_status) {
    el.textContent = "—";
    return;
  }
  const parts = Object.entries(run.feed_status).map(([k, v]) => {
    const ok = v.ok === true || v.ok === undefined;
    return `${k.toUpperCase()}: ${ok ? "OK" : v.error || "fail"}`;
  });
  el.textContent = parts.join(" · ");
  const lat = $("trust-latency");
  if (lat) lat.textContent = run.latency_ms != null ? `Scan ${run.latency_ms} ms` : "";
}

function setApiStatus(ok, msg) {
  const line = $("api-status-line");
  const text = $("api-status-text");
  if (!line || !text) return;
  line.querySelector(".dot").className = `dot ${ok ? "green" : "bad"}`;
  text.textContent = msg;
}

function fmtUsd(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function updateMorningCard(run) {
  const card = $("morning-card");
  const quiet = $("morning-quiet");
  const stats = $("morning-stats");
  const greet = $("morning-greeting");
  const meta = $("morning-scan-ms");
  const spotlight = $("policy-spotlight");

  if (!run || !run.summary) {
    card?.classList.add("hidden");
    return;
  }
  card?.classList.remove("hidden");
  const s = run.summary;
  const hits = run.hits || [];
  const impacted = s.policies_impacted ?? new Set(hits.map((h) => h.policy_id)).size;
  greet.textContent = `Good morning — here's your world (${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })})`;
  meta.textContent = run.latency_ms != null ? `Scan ${run.latency_ms} ms` : "";

  const relevant = hits.filter((h) => h.peril_alignment === "aligned");
  if (relevant.length === 0 && s.events_total > 0) {
    quiet.classList.remove("hidden");
    quiet.textContent =
      "Quiet for your portfolio: no aligned peril hits under current rules. Review out-of-scope overlaps in Live Events.";
  } else if (s.hits_total === 0 && s.events_total === 0) {
    quiet.classList.remove("hidden");
    quiet.textContent = "No events ingested this run — check feed status in the ribbon.";
  } else {
    quiet.classList.add("hidden");
  }

  stats.innerHTML = `
    <div class="stat-pill"><strong>${s.events_total ?? 0}</strong><span>Events</span></div>
    <div class="stat-pill"><strong>${s.hits_total ?? 0}</strong><span>Hits</span></div>
    <div class="stat-pill"><strong>${impacted}</strong><span>Policies</span></div>
  `;

  const top = [...hits].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
  if (top.length) {
    spotlight.classList.remove("hidden");
    spotlight.innerHTML = `<h4>Policy spotlight</h4>${top
      .map(
        (h) =>
          `<div class="spotlight-row"><strong>${h.policy_id}</strong> — score ${h.score?.toFixed?.(0) ?? h.score} — ${h.distance_mi} mi — ${h.peril_alignment}</div>`
      )
      .join("")}`;
  } else spotlight.classList.add("hidden");
}

async function runBriefing() {
  const loader = $("briefing-loader");
  const out = $("briefing-output");
  const structured = $("briefing-structured");
  const aiBox = $("briefing-ai");
  const stats = $("briefing-stats");
  loader?.classList.remove("hidden");
  out?.classList.add("hidden");
  structured?.classList.add("hidden");
  aiBox?.classList.add("hidden");

  const days = Number($("brief-days")?.value || 7);

  try {
    const run = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({ days_back: days, data_mode: "synthetic" }),
    });
    state.lastRun = run;
    state.prevRunId = state.lastRun?.run_id || state.prevRunId;
    setTrustRibbon(run);
    setApiStatus(true, "Scan complete");

    updateMorningCard(run);

    const brief = await api("/api/briefing", {
      method: "POST",
      body: JSON.stringify({ run_id: run.run_id, mode: "template" }),
    });
    state.briefingMarkdown = brief.markdown || "";
    structured?.classList.remove("hidden");
    structured.textContent = brief.markdown || "";
    aiBox?.classList.add("hidden");
    state._narrative = null;

    stats?.classList.remove("hidden");
    stats.innerHTML = `<div class="stat-box">Run <code>${run.run_id}</code></div>`;

    out?.classList.remove("hidden");
    out.innerHTML = `<pre class="report-pre">${escapeHtml(JSON.stringify(run.summary, null, 2))}</pre>`;

    loadEventsTable(run);
    $("events-loader")?.classList.add("hidden");
    $("events-output")?.classList.remove("hidden");
  } catch (e) {
    setApiStatus(false, e.message);
    structured?.classList.remove("hidden");
    structured.textContent = `API error: ${e.message}\n\nRun \`netlify dev\` locally or deploy with functions.`;
  } finally {
    loader?.classList.add("hidden");
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function loadEvents() {
  if (state.lastRun) {
    loadEventsTable(state.lastRun);
    $("events-loader")?.classList.add("hidden");
    $("events-output")?.classList.remove("hidden");
    return;
  }
  runBriefing();
}

function loadEventsTable(run) {
  const events = run.events || [];
  const hits = run.hits || [];
  const f = state.perilFilter;
  const evFiltered = f ? events.filter((e) => e.peril === f) : events;

  $("eq-count").textContent = evFiltered.filter((e) => e.feed === "usgs").length;
  $("al-count").textContent = evFiltered.filter((e) => e.feed === "nws").length;
  $("fe-count").textContent = evFiltered.filter((e) => e.feed === "fema").length;
  $("hi-count").textContent = hits.length;

  const wrap = $("events-table");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="peril-filter">
      ${["all", "convective", "earthquake", "flood", "wind", "wildfire", "winter"]
        .map(
          (p) =>
            `<button type="button" class="peril-chip ${f === p || (p === "all" && !f) ? "on" : ""}" data-peril="${p}">${p}</button>`
        )
        .join("")}
    </div>
    <table class="data-table"><thead><tr><th>Feed</th><th>Name</th><th>Peril</th><th>Severity</th></tr></thead><tbody>
    ${evFiltered
      .slice(0, 200)
      .map(
        (e) =>
          `<tr><td>${e.feed}</td><td>${escapeHtml(e.name || "")}</td><td>${e.peril}</td><td class="sev-${e.severity === "high" ? "high" : "low"}">${e.severity}</td></tr>`
      )
      .join("")}
    </tbody></table>
    <h4>Portfolio hits</h4>
    <table class="data-table"><thead><tr><th>Policy</th><th>Event</th><th>mi</th><th>Score</th><th>Align</th></tr></thead><tbody>
    ${hits
      .map(
        (h) =>
          `<tr><td>${h.policy_id}</td><td>${escapeHtml(h.notes || h.event_id || "")}</td><td>${h.distance_mi}</td><td>${h.score?.toFixed?.(0)}</td><td>${h.peril_alignment}</td></tr>`
      )
      .join("")}
    </tbody></table>`;

  wrap.querySelectorAll(".peril-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-peril");
      state.perilFilter = p === "all" ? null : p;
      loadEventsTable(run);
    });
  });
}

async function loadPML() {
  const loader = $("pml-loader");
  const out = $("pml-output");
  loader?.classList.remove("hidden");
  out?.classList.add("hidden");
  await new Promise((r) => setTimeout(r, 600));
  const aal = 12400000 + Math.random() * 2e6;
  const pml = 890000000 + Math.random() * 1e8;
  $("pml-kpis").innerHTML = `
    <div class="stat-box">AAL (demo) ${fmtUsd(aal)}</div>
    <div class="stat-box">PML 1:250 (demo) ${fmtUsd(pml)}</div>
  `;
  const ctx = $("ep-chart").getContext("2d");
  if (window.Chart) {
    new Chart(ctx, {
      type: "line",
      data: {
        labels: ["1:10", "1:25", "1:50", "1:100", "1:250"],
        datasets: [{ label: "EP (demo)", data: [0.1, 0.2, 0.35, 0.55, 1], borderColor: "#3d8bfd" }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }
  $("pml-table").innerHTML = "<p class=\"muted\">Illustrative only — not RMS/AIR.</p>";
  loader?.classList.add("hidden");
  out?.classList.remove("hidden");
}

let portfolioMap;
async function loadPortfolio() {
  const loader = $("portfolio-loader");
  const out = $("portfolio-output");
  loader?.classList.remove("hidden");
  out?.classList.add("hidden");
  let policies = state.portfolio;
  try {
    const r = await api("/api/portfolio");
    policies = r.policies || [];
    state.portfolio = policies;
  } catch {
    policies = state.portfolio || [];
  }
  const byPeril = {};
  for (const p of policies) {
    for (const x of p.perils || []) {
      byPeril[x] = (byPeril[x] || 0) + (p.insured_value || 0);
    }
  }
  $("portfolio-kpis").innerHTML = `<div class="stat-box">${policies.length} locations</div>`;
  const pc = $("peril-chart");
  if (pc && window.Chart) {
    const labels = Object.keys(byPeril);
    const data = labels.map((k) => (byPeril[k] || 0) / 1e6);
    new Chart(pc.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "TIV by peril tag ($M)", data }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }
  if (window.L && $("portfolio-map")) {
    if (!portfolioMap) {
      portfolioMap = L.map("portfolio-map").setView([39.8, -98.6], 4);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OSM" }).addTo(portfolioMap);
    }
    portfolioMap.eachLayer((l) => {
      if (l instanceof L.Marker) portfolioMap.removeLayer(l);
    });
    for (const p of policies) {
      L.circleMarker([p.lat, p.lon], { radius: 6 + Math.log10((p.insured_value || 1e6) / 1e6) * 6 })
        .bindPopup(`${p.policy_id} ${fmtUsd(p.insured_value)}`)
        .addTo(portfolioMap);
    }
  }
  $("portfolio-table").innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>State</th><th>TIV</th></tr></thead><tbody>
    ${policies.map((p) => `<tr><td>${p.policy_id}</td><td>${p.state}</td><td>${fmtUsd(p.insured_value)}</td></tr>`).join("")}</tbody></table>`;
  loader?.classList.add("hidden");
  out?.classList.remove("hidden");
}

function runDataQuality() {
  const loader = $("dq-loader");
  const out = $("dq-output");
  loader?.classList.remove("hidden");
  out?.classList.add("hidden");
  const policies = state.portfolio.length ? state.portfolio : [];
  const issues = [];
  for (const p of policies) {
    if (!p.lat || !p.lon) issues.push(`${p.policy_id}: missing coords`);
    if (!p.insured_value) issues.push(`${p.policy_id}: zero TIV`);
  }
  out.innerHTML =
    issues.length === 0
      ? "<p>No issues in loaded portfolio (or synthetic defaults).</p>"
      : `<ul>${issues.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
  loader?.classList.add("hidden");
  out?.classList.remove("hidden");
}

function runUnderwriting() {
  const out = $("uw-output");
  out?.classList.remove("hidden");
  out.innerHTML = "<p>Underwriting advisor: connect server-side LLM with portfolio context (Phase 3+).</p>";
}

function runClaims() {
  const loader = $("claims-loader");
  const out = $("claims-output");
  loader?.classList.remove("hidden");
  out?.classList.add("hidden");
  if (!state.lastRun) {
    out.innerHTML = "<p>Run a morning scan first.</p>";
    loader?.classList.add("hidden");
    out?.classList.remove("hidden");
    return;
  }
  const hits = [...(state.lastRun.hits || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
  out.innerHTML = `<table class="data-table"><thead><tr><th>Rank</th><th>Policy</th><th>Score</th><th>Notes</th></tr></thead><tbody>
    ${hits.map((h, i) => `<tr><td>${i + 1}</td><td>${h.policy_id}</td><td>${h.score?.toFixed?.(0)}</td><td>${escapeHtml(h.notes || "")}</td></tr>`).join("")}
  </tbody></table>`;
  loader?.classList.add("hidden");
  out?.classList.remove("hidden");
}

function copyBriefEmail() {
  const t = state.briefingMarkdown || $("briefing-structured")?.textContent || "";
  navigator.clipboard.writeText(t);
}

function copyBriefSlides() {
  const lines = (state.briefingMarkdown || "").split("\n").filter((l) => l.startsWith("-") || l.startsWith("##"));
  navigator.clipboard.writeText(lines.join("\n"));
}

function draftOutreach() {
  const h = state.lastRun?.hits?.[0];
  if (!h) {
    alert("No hits — run scan first.");
    return;
  }
  const text = `Subject: Exposure note — ${h.policy_id}\n\nTeam — we have a rules-based hit (${h.distance_mi} mi, score ${h.score?.toFixed?.(0)}). Please review against underwriting guidelines. Numbers are proximity/TIV only, not loss.\n`;
  navigator.clipboard.writeText(text);
}

async function runPromptPack(kind) {
  if (!state.lastRun) {
    await runBriefing();
    return;
  }
  const s = state.lastRun.summary;
  const packs = {
    summary: `Summarize: ${s.events_total} events, ${s.hits_total} hits. Include three caveats: not loss estimate, NWS snapshot, FEMA lag.`,
    exec: `Two sentences for leadership: ${s.events_total} events ingested; ${s.hits_total} portfolio hits under current radii. No loss estimate.`,
    underwriting: `Draft measured note to underwriting: ${s.hits_total} hits; top policy ${state.lastRun.hits?.[0]?.policy_id || "n/a"}. TIV proximity only.`,
  };
  navigator.clipboard.writeText(packs[kind] || "");
  alert("Prompt copied to clipboard — paste into your LLM with the structured JSON from the run.");
}

window.switchTab = function (tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  const map = { earthquakes: 0, alerts: 1, fema: 2, hits: 3 };
  const tabs = document.querySelectorAll(".tab-btn");
  if (tabs[map[tab] ?? 0]) tabs[map[tab] ?? 0].classList.add("active");
};

window.runBriefing = runBriefing;
window.loadEvents = loadEvents;
window.loadPML = loadPML;
window.loadPortfolio = loadPortfolio;
window.runDataQuality = runDataQuality;
window.runUnderwriting = runUnderwriting;
window.runClaims = runClaims;
window.copyBriefEmail = copyBriefEmail;
window.copyBriefSlides = copyBriefSlides;
window.draftOutreach = draftOutreach;
window.runPromptPack = runPromptPack;

async function generateAiNarrative() {
  if (!state.lastRun?.run_id) {
    await runBriefing();
    return;
  }
  const aiBox = $("briefing-ai");
  try {
    const brief = await api("/api/briefing", {
      method: "POST",
      body: JSON.stringify({ run_id: state.lastRun.run_id, mode: "llm" }),
    });
    state._narrative = brief.narrative;
    if (brief.narrative && !$("numbers-only")?.checked) {
      aiBox?.classList.remove("hidden");
      aiBox.innerHTML = `<div class="briefing-ai-label">AI narrative (draft)</div><div>${escapeHtml(brief.narrative)}</div>`;
    }
  } catch (e) {
    alert("Narrative failed (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY on Netlify): " + e.message);
  }
}

window.generateAiNarrative = generateAiNarrative;

/* Nav */
document.querySelectorAll(".nav-btn[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tool-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const tool = btn.getAttribute("data-tool");
    $(`tool-${tool}`)?.classList.add("active");
  });
});

/* Sidebar date */
function tickDate() {
  const el = $("sidebar-date");
  if (el) {
    el.textContent = new Date().toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
tickDate();
setInterval(tickDate, 60000);

/* Command palette */
const commands = [
  { label: "Run morning scan", run: () => runBriefing() },
  { label: "Copy briefing (email)", run: () => copyBriefEmail() },
  { label: "Open Live Events", run: () => document.querySelector('[data-tool="events"]')?.click() },
  { label: "Help / methodology", run: () => toggleHelpDrawer(true) },
];

function openCommandPalette() {
  const p = $("command-palette");
  if (!p) return;
  p.classList.remove("hidden");
  $("command-input")?.focus();
  renderCommands(commands);
}

function closeCommandPalette() {
  $("command-palette")?.classList.add("hidden");
}

function renderCommands(list) {
  const ul = $("command-list");
  if (!ul) return;
  ul.innerHTML = list
    .map(
      (c, i) =>
        `<li><button type="button" data-index="${i}">${escapeHtml(c.label)}</button></li>`
    )
    .join("");
  list.forEach((c, i) => {
    ul.querySelector(`[data-index="${i}"]`)?.addEventListener("click", () => {
      c.run();
      closeCommandPalette();
    });
  });
}

$("command-input")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderCommands(commands.filter((c) => c.label.toLowerCase().includes(q)));
});

window.closeCommandPalette = closeCommandPalette;

function toggleHelpDrawer(open) {
  $("help-drawer")?.classList.toggle("hidden", !open);
}

window.toggleHelpDrawer = toggleHelpDrawer;

/* Keyboard */
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    openCommandPalette();
  }
  if (e.key === "?" && !e.target.matches("input,textarea")) {
    toggleHelpDrawer(true);
  }
  if (e.key === "s" && !e.target.matches("input,textarea")) {
    runBriefing();
  }
  if (e.key === "b" && !e.target.matches("input,textarea")) {
    copyBriefEmail();
  }
});

/* Dark / light */
function toggleDarkMode() {
  document.documentElement.classList.toggle("light");
  localStorage.setItem("theme", document.documentElement.classList.contains("light") ? "light" : "dark");
}

window.toggleDarkMode = toggleDarkMode;
if (localStorage.getItem("theme") === "light") document.documentElement.classList.add("light");

/* Numbers-only */
$("numbers-only")?.addEventListener("change", () => {
  const aiBox = $("briefing-ai");
  if ($("numbers-only")?.checked) aiBox?.classList.add("hidden");
  else if (state._narrative) {
    aiBox?.classList.remove("hidden");
    aiBox.innerHTML = `<div class="briefing-ai-label">AI narrative (draft)</div><div>${escapeHtml(state._narrative)}</div>`;
  }
});

/* Initial: try load portfolio */
(async () => {
  try {
    const r = await api("/api/portfolio");
    state.portfolio = r.policies || [];
    setApiStatus(true, "Ready");
  } catch {
    setApiStatus(false, "Offline — run netlify dev");
  }
  try {
    const s = await api("/api/settings");
    const mode = s?.settings?.data_mode || "synthetic";
    const badge = $("data-mode-badge");
    if (badge) {
      badge.textContent = `${mode} data`;
      badge.className = `data-mode-badge data-mode-${mode === "real" ? "real" : "synthetic"}`;
    }
  } catch {
    /* optional */
  }
})();

window.exportMapSnapshot = () => {
  window.print();
};
