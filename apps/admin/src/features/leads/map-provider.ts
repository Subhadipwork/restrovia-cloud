import type { LatLng, Place } from './location-picker';

/**
 * Mapbox public token, read at build time. Secret tokens (`sk.`) are refused: anything here ships
 * in the browser bundle. Without a usable token the lead map falls back to Leaflet and OpenStreetMap.
 */
const RAW_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ?? '';
export const MAPBOX_TOKEN = RAW_TOKEN.startsWith('pk.') ? RAW_TOKEN : '';
if (RAW_TOKEN && !MAPBOX_TOKEN && typeof window !== 'undefined') {
  console.warn('NEXT_PUBLIC_MAPBOX_TOKEN must be a public (pk.) token; using OpenStreetMap');
}

/** OpenStreetMap tiles for the fallback map when no Mapbox token is set. */
export const tileSource = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
};

// --- Mapbox Geocoding v6 ---------------------------------------------------------------------

const MAPBOX_GEOCODE = 'https://api.mapbox.com/search/geocode/v6';

type MapboxFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    full_address?: string;
    name?: string;
    context?: Partial<
      Record<'neighborhood' | 'locality' | 'place' | 'district' | 'region', { name?: string }>
    >;
  };
};

function mapboxPlace(f: MapboxFeature | null | undefined): Place | null {
  const p = f?.properties;
  const address = p?.full_address ?? p?.name;
  if (!address) return null;
  const c = p?.context ?? {};
  return {
    address,
    area: c.neighborhood?.name ?? c.locality?.name ?? null,
    city: c.place?.name ?? c.district?.name ?? null
  };
}

async function mapboxGet(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, language: 'en', access_token: MAPBOX_TOKEN });
  const res = await fetch(`${MAPBOX_GEOCODE}/${path}?${qs}`);
  if (!res.ok) return null;
  return ((await res.json()) as { features?: MapboxFeature[] }).features?.[0];
}

// --- OpenStreetMap Nominatim (fallback) ------------------------------------------------------

const NOMINATIM = 'https://nominatim.openstreetmap.org';

type NominatimAddress = Partial<
  Record<
    | 'suburb'
    | 'neighbourhood'
    | 'quarter'
    | 'residential'
    | 'city_district'
    | 'city'
    | 'town'
    | 'village'
    | 'county'
    | 'state_district',
    string
  >
>;

function nominatimPlace(r: { display_name?: string; address?: NominatimAddress }): Place | null {
  if (!r.display_name) return null;
  const a = r.address ?? {};
  return {
    address: r.display_name,
    area: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.residential ?? a.city_district ?? null,
    city: a.city ?? a.town ?? a.village ?? a.county ?? a.state_district ?? null
  };
}

// --- Public API --------------------------------------------------------------------------------

/** The address at a map point, split into the lead form's fields. */
export async function reverseGeocode(p: LatLng): Promise<Place | null> {
  if (MAPBOX_TOKEN) {
    return mapboxPlace(
      await mapboxGet('reverse', { longitude: String(p.lng), latitude: String(p.lat), limit: '1' })
    );
  }
  const qs = new URLSearchParams({
    format: 'jsonv2',
    lat: String(p.lat),
    lon: String(p.lng),
    addressdetails: '1',
    'accept-language': 'en'
  });
  const res = await fetch(`${NOMINATIM}/reverse?${qs}`);
  return res.ok ? nominatimPlace(await res.json()) : null;
}

/** The best match in India for a typed place or address. */
export async function searchPlace(q: string): Promise<(LatLng & { place: Place | null }) | null> {
  if (MAPBOX_TOKEN) {
    const hit = await mapboxGet('forward', { q, country: 'in', limit: '1' });
    const [lng, lat] = hit?.geometry?.coordinates ?? [];
    return lat === undefined || lng === undefined ? null : { lat, lng, place: mapboxPlace(hit) };
  }
  const qs = new URLSearchParams({
    format: 'jsonv2',
    q,
    countrycodes: 'in',
    limit: '1',
    addressdetails: '1',
    'accept-language': 'en'
  });
  const res = await fetch(`${NOMINATIM}/search?${qs}`);
  if (!res.ok) return null;
  const [hit] = (await res.json()) as {
    lat: string;
    lon: string;
    display_name?: string;
    address?: NominatimAddress;
  }[];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), place: nominatimPlace(hit) } : null;
}
