import crypto from "node:crypto";
import { nwsEventToPeril } from "./perilMap.mjs";

const SCHEMA = "1";

function hash(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function usBounds(lat, lon) {
  if (lat < 17 || lat > 72) return false;
  if (lon > -64 || lon < -179) return false;
  return true;
}

export function normalizeUsgsFeature(f) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry?.coordinates || [0, 0];
  if (!usBounds(lat, lon)) return null;
  const mag = p.mag ?? 0;
  const severity = mag >= 6 ? "high" : mag >= 5 ? "medium" : mag >= 3.5 ? "low" : "info";
  const id = `USGS-${p.id || f.id || hash(JSON.stringify(f))}`;
  const name = p.title || `M${mag} earthquake`;
  const norm = {
    event_id: id,
    feed: "usgs",
    schema_version: SCHEMA,
    occurred_at_utc: p.time ? new Date(p.time).toISOString() : new Date().toISOString(),
    updated_at_utc: p.updated ? new Date(p.updated).toISOString() : null,
    name,
    peril: "earthquake",
    severity,
    tier: mag >= 5 ? 1 : 2,
    geometry: f.geometry,
    source_url: p.url || "https://earthquake.usgs.gov/",
    raw_properties_json: p,
  };
  norm.content_hash = hash(JSON.stringify({ id: norm.event_id, mag, lon, lat }));
  return norm;
}

export function normalizeNwsFeature(f) {
  const p = f.properties || {};
  const event = p.event || "";
  const { peril, tier } = nwsEventToPeril(event);
  const sev = p.severity === "Extreme" || p.severity === "Severe" ? "high" : p.severity === "Moderate" ? "medium" : "low";
  const id = `NWS-${p.id || hash(JSON.stringify(p))}`;
  const norm = {
    event_id: id,
    feed: "nws",
    schema_version: SCHEMA,
    occurred_at_utc: p.sent ? new Date(p.sent).toISOString() : new Date().toISOString(),
    updated_at_utc: p.effective ? new Date(p.effective).toISOString() : null,
    name: p.headline || event || "NWS Alert",
    peril,
    severity: sev,
    tier,
    geometry: f.geometry || null,
    source_url: p.id ? `https://api.weather.gov/alerts/land/${p.id.split("/").pop()}` : "https://www.weather.gov/",
    raw_properties_json: p,
  };
  norm.content_hash = hash(JSON.stringify({ id: norm.event_id, sent: p.sent, ends: p.ends, geometry: f.geometry }));
  return norm;
}

export function normalizeFemaRecord(r) {
  const id = `FEMA-${r.disasterNumber}-${r.state || "XX"}`;
  const norm = {
    event_id: id,
    feed: "fema",
    schema_version: SCHEMA,
    occurred_at_utc: r.declarationDate ? new Date(r.declarationDate).toISOString() : new Date().toISOString(),
    updated_at_utc: null,
    name: `${r.declarationTitle || "Disaster"} (${r.state})`,
    peril: "wind",
    severity: "low",
    tier: 3,
    geometry: null,
    source_url: "https://www.fema.gov/",
    raw_properties_json: r,
  };
  norm.content_hash = hash(JSON.stringify(r));
  return norm;
}

export function normalizeSpcFeatures(features, raw) {
  const out = [];
  for (const f of features) {
    const p = f.properties || {};
    const id = `SPC-${p.LABEL || p.label || hash(JSON.stringify(f.geometry))}`;
    const norm = {
      event_id: id,
      feed: "spc",
      schema_version: SCHEMA,
      occurred_at_utc: new Date().toISOString(),
      updated_at_utc: null,
      name: `SPC Outlook ${p.LABEL || p.label || "Day1"}`,
      peril: "convective",
      severity: String(p.LABEL || "").includes("HIGH") ? "high" : "medium",
      tier: 2,
      geometry: f.geometry,
      source_url: "https://www.spc.noaa.gov/",
      raw_properties_json: p,
    };
    norm.content_hash = hash(JSON.stringify(f.geometry));
    out.push(norm);
  }
  if (out.length === 0 && raw?.type === "FeatureCollection") {
    for (const f of raw.features || []) {
      const n = normalizeSpcFeatures([f], null);
      out.push(...n);
    }
  }
  return out;
}

export function normalizeNhcFeatures(features) {
  const out = [];
  for (const f of features) {
    const p = f.properties || {};
    const id = `NHC-${p.STORMNAME || p.name || hash(JSON.stringify(f))}`;
    const norm = {
      event_id: id,
      feed: "nhc",
      schema_version: SCHEMA,
      occurred_at_utc: new Date().toISOString(),
      updated_at_utc: null,
      name: `Tropical: ${p.STORMNAME || p.name || "Active"}`,
      peril: "wind",
      severity: "high",
      tier: 1,
      geometry: f.geometry,
      source_url: "https://www.nhc.noaa.gov/",
      raw_properties_json: p,
    };
    norm.content_hash = hash(JSON.stringify(f.geometry));
    out.push(norm);
  }
  return out;
}
