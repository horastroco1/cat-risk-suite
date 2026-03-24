/** USGS, NWS, FEMA, SPC, NHC fetchers with ETag + User-Agent */

const UA = process.env.NWS_USER_AGENT || "CATRiskSuite/1.0 (https://github.com/cat-risk-suite; ops@example.com)";

async function fetchJson(url, opts = {}) {
  const headers = { ...opts.headers, Accept: opts.accept || "application/json" };
  const res = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(18000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return { res, data: await res.json() };
}

export async function fetchUsgsEarthquakes(daysBack = 7, minMag = 2.5) {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400000);
  const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", start.toISOString().slice(0, 10));
  url.searchParams.set("endtime", end.toISOString().slice(0, 10));
  url.searchParams.set("minmagnitude", String(minMag));
  url.searchParams.set("orderby", "time");
  const { data } = await fetchJson(url.toString());
  return { feed: "usgs", features: data.features || [] };
}

export async function fetchNwsActive(extraHeaders = {}) {
  const url = "https://api.weather.gov/alerts/active?status=actual";
  const headers = { "User-Agent": UA, Accept: "application/geo+json", ...extraHeaders };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const data = await res.json();
  return {
    feed: "nws",
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    features: data.features || [],
  };
}

export async function fetchFemaDeclarations(daysBack = 7) {
  const start = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const filter = encodeURIComponent(`declarationDate ge '${start}'`);
  const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${filter}&$orderby=declarationDate%20desc&$top=100`;
  const { data } = await fetchJson(url.toString());
  return { feed: "fema", records: data.DisasterDeclarationsSummaries || [] };
}

/** SPC Day 1 Convective Outlook GeoJSON (public) */
export async function fetchSpcDay1() {
  const urls = [
    "https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson",
    "https://www.spc.noaa.gov/geojson/day1outlook.json",
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const { data } = await fetchJson(u);
      return { feed: "spc", url: u, features: data.features || data.geometries || [], raw: data };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("SPC fetch failed");
}

/** NHC tropical cyclone GIS (optional; may return empty) */
export async function fetchNhcActive() {
  try {
    const url =
      "https://services9.arcgis.com/KcxWmXuW9hMcxg6F/arcgis/rest/services/Active_NHC_Atlantic_Tropical_Cyclones/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";
    const { data } = await fetchJson(url);
    return { feed: "nhc", features: data.features || [] };
  } catch {
    return { feed: "nhc", features: [], error: "NHC layer unavailable" };
  }
}
