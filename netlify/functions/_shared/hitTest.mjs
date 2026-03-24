import * as turf from "@turf/turf";
import { haversineMiles } from "./geo.mjs";
import { defaultRadiusMi, severityWeight } from "./perilMap.mjs";

/** Point inside GeoJSON Polygon/MultiPolygon */
export function pointInPolygon(lat, lon, geometry) {
  if (!geometry) return { inside: false, distanceMi: null };
  try {
    const pt = turf.point([lon, lat]);
    let g = geometry;
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      const poly = turf.feature(geometry);
      if (turf.booleanPointInPolygon(pt, poly)) return { inside: true, distanceMi: 0 };
      const c = turf.centroid(poly);
      const [clon, clat] = c.geometry.coordinates;
      const d = haversineMiles(lat, lon, clat, clon);
      return { inside: false, distanceMi: d };
    }
  } catch {
    /* fall through */
  }
  return { inside: false, distanceMi: null };
}

export function hitScore({ tier, distanceMi, radiusMi, insuredValue, perilAligned }) {
  const sw = severityWeight(tier);
  const r = Math.max(radiusMi, 1);
  const d = distanceMi == null ? r : distanceMi;
  const distW = 40 * Math.max(0, 1 - d / r);
  const valW = 10 * Math.min(1, Math.log10((insuredValue || 0) / 1_000_000 + 1));
  const align = perilAligned ? 0 : -5;
  return Math.min(100, Math.max(0, sw + distW + valW + align));
}

/**
 * @param events normalized events with geometry
 * @param policies array of { policy_id, lat, lon, perils: string[] }
 * @param radiusByPeril optional map
 */
export function computeHits(events, policies, radiusByPeril = {}) {
  const hits = [];
  for (const ev of events) {
    const peril = ev.peril || "wind";
    const r = defaultRadiusMi(peril, radiusByPeril);
    for (const pol of policies) {
      const polPerils = (pol.perils || []).map((x) => String(x).toLowerCase());
      const perilAligned =
        polPerils.length === 0 ||
        polPerils.some((p) => peril.includes(p) || p.includes(peril)) ||
        (peril === "convective" && polPerils.some((p) => ["tornado", "hail", "wind"].includes(p)));
      let distanceMi;
      let inside = false;
      if (ev.feed === "usgs" || (ev.geometry && ev.geometry.type === "Point")) {
        const [elon, elat] = ev.geometry?.coordinates || [0, 0];
        distanceMi = haversineMiles(pol.lat, pol.lon, elat, elon);
        inside = distanceMi <= r;
      } else if (ev.geometry && (ev.geometry.type === "Polygon" || ev.geometry.type === "MultiPolygon")) {
        const pip = pointInPolygon(pol.lat, pol.lon, ev.geometry);
        inside = pip.inside || (pip.distanceMi != null && pip.distanceMi <= r);
        distanceMi = pip.inside ? 0 : pip.distanceMi;
      } else {
        distanceMi = 9999;
        inside = false;
      }
      if (!inside) continue;
      const tier = ev.tier ?? 2;
      const score = hitScore({
        tier,
        distanceMi: distanceMi ?? r,
        radiusMi: r,
        insuredValue: pol.insured_value,
        perilAligned,
      });
      hits.push({
        event_id: ev.event_id,
        policy_id: pol.policy_id,
        distance_mi: distanceMi == null ? null : Math.round(distanceMi * 100) / 100,
        inside_polygon: ev.geometry?.type?.includes("Polygon") ? distanceMi === 0 : false,
        peril_alignment: perilAligned ? "aligned" : "out_of_scope",
        tier,
        score,
        notes: ev.name,
      });
    }
  }
  return hits;
}
