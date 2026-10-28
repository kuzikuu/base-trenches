// Coarse, aggregate-only presence geography for the world map.
// Input is Cloudflare's request.cf.country / request.cf.continent at WebSocket connect.
// We never store or expose IPs, cities, coordinates or anything per-player: only counts.

export const CONTINENTS = new Set(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']);

// Parse the internal X-BT-Geo header ("US|NA"). Unknown / Tor (T1) / XX -> null fields.
export function parseGeo(header) {
  const [c, k] = String(header || '').toUpperCase().split('|');
  const cc = /^[A-Z]{2}$/.test(c || '') && c !== 'XX' && c !== 'T1' ? c : null;
  const ct = CONTINENTS.has(k) ? k : null;
  return { cc, ct };
}

export function geoHeader(cf) {
  const cc = cf && typeof cf.country === 'string' ? cf.country : '';
  const ct = cf && typeof cf.continent === 'string' ? cf.continent : '';
  return `${cc}|${ct}`;
}

// geos: array of {cc, ct} for connected HUMANS only.
export function aggregateGeo(geos) {
  const countries = {}, regions = {};
  let unknown = 0;
  for (const g of geos) {
    if (!g || (!g.cc && !g.ct)) { unknown++; continue; }
    if (g.cc) countries[g.cc] = (countries[g.cc] || 0) + 1;
    if (g.ct) regions[g.ct] = (regions[g.ct] || 0) + 1;
    else if (!g.cc) unknown++;
  }
  return { countries, regions, unknown };
}
