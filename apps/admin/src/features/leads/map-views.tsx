'use client';

import 'leaflet/dist/leaflet.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { LeafletMouseEvent, Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import type { Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from './location-picker';
import { MAPBOX_TOKEN, tileSource } from './map-provider';

const INDIA: LatLng = { lat: 22.5, lng: 79 };
const PIN_ZOOM = 16;

/** Mapbox's own light and dark basemaps, picked from the panel's light or dark mode. */
const mapboxStyle = (dark: boolean) =>
  dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12';

function useDarkMode() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark';
}

type MapViewProps = {
  value: LatLng | null;
  readOnly?: boolean;
  /** Called when the admin clicks the map or drops the dragged pin. */
  onPick?: (p: LatLng) => void;
  className: string;
};

const frame = (className: string) =>
  `bg-muted relative z-0 w-full overflow-hidden rounded-lg border ${className}`;

/** Keeps the latest `onPick` reachable from map listeners registered once. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Mapbox GL JS (vector Mapbox Streets), following Mapbox's React guide: a ref'd container, one map per mount. */
function MapboxView({ value, readOnly, onPick, className }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const marker = useRef<MapboxMarker | null>(null);
  const [ready, setReady] = useState(false);
  const pick = useLatest(onPick);
  const dark = useDarkMode();
  const shownStyle = useRef<string | null>(null);
  const wantedStyle = useLatest(mapboxStyle(dark));

  useEffect(() => {
    const run = { cancelled: false };
    let observer: ResizeObserver | undefined;
    void import('mapbox-gl').then(({ default: mapboxgl }) => {
      if (run.cancelled || !el.current) return;
      const m = new mapboxgl.Map({
        container: el.current,
        accessToken: MAPBOX_TOKEN,
        style: wantedStyle.current,
        center: [INDIA.lng, INDIA.lat],
        zoom: 3.5,
        scrollZoom: !readOnly,
        dragRotate: false,
        pitchWithRotate: false
      });
      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
      const pinEl = document.createElement('div');
      pinEl.className = 'lead-map-pin';
      const pin = new mapboxgl.Marker({ element: pinEl, draggable: !readOnly, anchor: 'bottom' });
      if (!readOnly) {
        m.on('click', (e) => pick.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
        pin.on('dragend', () => {
          const p = pin.getLngLat();
          pick.current?.({ lat: p.lat, lng: p.lng });
        });
      }
      shownStyle.current = wantedStyle.current;
      observer = new ResizeObserver(() => m.resize());
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
      setReady(false);
    };
  }, [readOnly, pick, wantedStyle]);

  useEffect(() => {
    const m = map.current;
    const style = mapboxStyle(dark);
    if (!ready || !m || shownStyle.current === style) return;
    shownStyle.current = style;
    m.setStyle(style);
  }, [ready, dark]);

  useEffect(() => {
    const m = map.current;
    const pin = marker.current;
    if (!ready || !m || !pin) return;
    if (!value) {
      pin.remove();
      return;
    }
    pin.setLngLat([value.lng, value.lat]).addTo(m);
    if (!m.getBounds()?.contains([value.lng, value.lat]) || m.getZoom() < 14) {
      m.jumpTo({ center: [value.lng, value.lat], zoom: Math.max(m.getZoom(), PIN_ZOOM) });
    }
  }, [ready, value]);

  return <div ref={el} className={frame(className)} />;
}

/** Leaflet with OpenStreetMap tiles: used when no Mapbox public token is configured. */
function LeafletView({ value, readOnly, onPick, className }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<LeafletMarker | null>(null);
  const [ready, setReady] = useState(false);
  const pick = useLatest(onPick);

  useEffect(() => {
    const run = { cancelled: false };
    let observer: ResizeObserver | undefined;
    void import('leaflet').then((L) => {
      if (run.cancelled || !el.current) return;
      const m = L.map(el.current, {
        center: [INDIA.lat, INDIA.lng],
        zoom: 4,
        scrollWheelZoom: !readOnly
      });
      L.tileLayer(tileSource.url, {
        maxZoom: tileSource.maxZoom,
        attribution: tileSource.attribution
      }).addTo(m);
      const icon = L.divIcon({
        className: '',
        html: '<div class="lead-map-pin"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      const pin = L.marker([INDIA.lat, INDIA.lng], { icon, draggable: !readOnly, keyboard: false });
      if (!readOnly) {
        m.on('click', (e: LeafletMouseEvent) => pick.current?.(e.latlng));
        pin.on('dragend', () => pick.current?.(pin.getLatLng()));
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
      setReady(false);
    };
  }, [readOnly, pick]);

  useEffect(() => {
    const m = map.current;
    const pin = marker.current;
    if (!ready || !m || !pin) return;
    if (!value) {
      pin.remove();
      return;
    }
    pin.setLatLng([value.lat, value.lng]);
    if (!m.hasLayer(pin)) pin.addTo(m);
    if (!m.getBounds().pad(-0.2).contains([value.lat, value.lng]) || m.getZoom() < 14) {
      m.setView([value.lat, value.lng], Math.max(m.getZoom(), PIN_ZOOM));
    }
  }, [ready, value]);

  return <div ref={el} className={`lead-map-osm ${frame(className)}`} />;
}

/** The lead map: Mapbox when a public token is set at build time, else OpenStreetMap. */
export const MapView = MAPBOX_TOKEN ? MapboxView : LeafletView;
