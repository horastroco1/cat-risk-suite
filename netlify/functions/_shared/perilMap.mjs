/** NWS event → internal peril + default tier (1=warning/observed, 2=watch, 3=advisory) */
export function nwsEventToPeril(eventName = "") {
  const e = eventName.toLowerCase();
  if (e.includes("tornado")) return { peril: "convective", tier: e.includes("warning") ? 1 : e.includes("watch") ? 2 : 2 };
  if (e.includes("severe thunderstorm")) return { peril: "convective", tier: e.includes("warning") ? 1 : 2 };
  if (e.includes("flash flood")) return { peril: "flood", tier: e.includes("warning") ? 1 : 2 };
  if (e.includes("flood")) return { peril: "flood", tier: 1 };
  if (e.includes("hurricane") || e.includes("tropical storm") || e.includes("typhoon")) return { peril: "wind", tier: 1 };
  if (e.includes("red flag")) return { peril: "wildfire", tier: 2 };
  if (e.includes("winter") || e.includes("blizzard") || e.includes("ice")) return { peril: "winter", tier: 2 };
  if (e.includes("wind") || e.includes("dust")) return { peril: "wind", tier: 2 };
  return { peril: "wind", tier: 3 };
}

export function severityWeight(tier) {
  if (tier === 1) return 60;
  if (tier === 2) return 40;
  return 20;
}

export function defaultRadiusMi(peril, defaults = {}) {
  const d = { earthquake: 75, convective: 25, flood: 10, wind: 50, wildfire: 15, winter: 40 };
  return defaults[peril] ?? d[peril] ?? 50;
}
