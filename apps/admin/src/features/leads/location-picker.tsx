'use client';

import 'leaflet/dist/leaflet.css';
import type { LeafletMouseEvent, Map as LeafletMap, Marker } from 'leaflet';
import { IconCurrentLocation, IconMapPinOff, IconSearch } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type LatLng = { lat: number; lng: number };

/** An address found for a map point, split into the lead form's fields. */
export type Place = { address: string; area: string | null; city: string | null };

const INDIA: LatLng = { lat: 22.5, lng: 79 };
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

function toPlace(r: { display_name?: string; address?: NominatimAddress }): Place | null {
  if (!r.display_name) return null;
  const a = r.address ?? {};
  return {
    address: r.display_name,
    area: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.residential ?? a.city_district ?? null,
    city: a.city ?? a.town ?? a.village ?? a.county ?? a.state_district ?? null
  };
}

async function reverseGeocode(p: LatLng): Promise<Place | null> {
  const qs = new URLSearchParams({
    format: 'jsonv2',
    lat: String(p.lat),
    lon: String(p.lng),
    addressdetails: '1',
    'accept-language': 'en'
  });
  const res = await fetch(`${NOMINATIM}/reverse?${qs}`);
  return res.ok ? toPlace(await res.json()) : null;
}

async function searchPlace(q: string): Promise<(LatLng & { place: Place | null }) | null> {
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
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), place: toPlace(hit) } : null;
}

const round6 = (p: LatLng): LatLng => ({
  lat: Math.round(p.lat * 1e6) / 1e6,
  lng: Math.round(p.lng * 1e6) / 1e6
});

export const googleMapsUrl = (p: LatLng) =>
  `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/**
 * OpenStreetMap with one pin. Editable: click or drag to place it, search an address, or use
 * this device's location; the address found for the pin is offered to the form through `onPlace`.
 */
export function LocationPicker({
  value,
  onChange,
  onPlace,
  readOnly,
  className = 'h-64'
}: {
  value: LatLng | null;
  onChange?: (v: LatLng | null) => void;
  /** `overwrite` is true when the admin asked to use the found address, false when it was automatic. */
  onPlace?: (place: Place, overwrite: boolean) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<null | 'search' | 'locate'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [found, setFound] = useState<Place | null>(null);
  const latest = useRef({ onChange, onPlace });
  useEffect(() => {
    latest.current = { onChange, onPlace };
  });

  const place = async (p: LatLng, known?: Place | null) => {
    const point = round6(p);
    latest.current.onChange?.(point);
    setMessage(null);
    const result = known ?? (await reverseGeocode(point).catch(() => null));
    setFound(result);
    if (result) latest.current.onPlace?.(result, false);
  };
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });

  useEffect(() => {
    const run = { cancelled: false };
    let observer: ResizeObserver | undefined;
    void import('leaflet').then((L) => {
      if (run.cancelled || !el.current) return;
      const m = L.map(el.current, {
        center: [INDIA.lat, INDIA.lng],
        zoom: 4,
        scrollWheelZoom: !readOnly,
        attributionControl: true
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(m);
      const icon = L.divIcon({
        className: '',
        html: '<div class="lead-map-pin"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      const pin = L.marker([INDIA.lat, INDIA.lng], { icon, draggable: !readOnly, keyboard: false });
      if (!readOnly) {
        m.on('click', (e: LeafletMouseEvent) => void placeRef.current(e.latlng));
        pin.on('dragend', () => void placeRef.current(pin.getLatLng()));
      }
      observer = new ResizeObserver(() => m.invalidateSize());
      observer.observe(el.current);
      map.current = m;
      marker.current = pin;
      setReady(true);
    });
    return () => {
      run.cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const m = map.current;
    const pin = marker.current;
    if (!ready || !m || !pin) return;
    if (value) {
      pin.setLatLng([value.lat, value.lng]);
      if (!m.hasLayer(pin)) pin.addTo(m);
      if (!m.getBounds().pad(-0.2).contains([value.lat, value.lng]) || m.getZoom() < 14) {
        m.setView([value.lat, value.lng], Math.max(m.getZoom(), 16));
      }
    } else {
      pin.remove();
    }
  }, [ready, value]);

  const locate = () => {
    if (!navigator.geolocation) {
      setMessage('This browser can’t share its location.');
      return;
    }
    setBusy('locate');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        void place({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setBusy(null);
        setMessage(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked for this site. Allow it in the browser, or place the pin by hand.'
            : 'Couldn’t find this device’s location. Place the pin by hand.'
        );
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy('search');
    const hit = await searchPlace(q).catch(() => null);
    setBusy(null);
    if (!hit) {
      setMessage('No place found. Try the area and city, or place the pin by hand.');
      return;
    }
    await place(hit, hit.place);
  };

  return (
    <div className='flex flex-col gap-2'>
      {!readOnly && (
        <div className='flex flex-wrap gap-2'>
          <Input
            aria-label='Search for a place'
            placeholder='Search a place or address'
            className='min-w-0 flex-1'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
          <Button
            type='button'
            variant='outline'
            disabled={!!busy || !query.trim()}
            onClick={() => void search()}
          >
            <IconSearch />
            {busy === 'search' ? 'Searching…' : 'Search'}
          </Button>
          <Button type='button' variant='outline' disabled={!!busy} onClick={locate}>
            <IconCurrentLocation />
            {busy === 'locate' ? 'Finding…' : 'Use my location'}
          </Button>
          {value && (
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                onChange?.(null);
                setFound(null);
              }}
            >
              <IconMapPinOff />
              Remove pin
            </Button>
          )}
        </div>
      )}
      <div
        ref={el}
        className={`bg-muted relative z-0 w-full overflow-hidden rounded-lg border ${className}`}
      />
      {!readOnly && (
        <p className='text-muted-foreground text-xs'>
          {value
            ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Drag it or click the map to move it.`
            : 'Click the map to drop a pin.'}
        </p>
      )}
      {message && <p className='text-destructive text-sm'>{message}</p>}
      {!readOnly && found && value && (
        <div className='bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-md p-2 text-sm'>
          <span className='text-muted-foreground min-w-0 flex-1'>{found.address}</span>
          <Button type='button' size='sm' variant='outline' onClick={() => onPlace?.(found, true)}>
            Use this address
          </Button>
        </div>
      )}
    </div>
  );
}
