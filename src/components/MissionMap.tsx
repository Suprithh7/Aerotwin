import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  AttributionControl as AttributionControlInstance,
  GeoJSONSource,
  LayerSpecification,
  Map as MaplibreMap,
  MapMouseEvent,
  Marker as MaplibreMarker,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, LineString, Polygon } from 'geojson';
import {
  currentPlan,
  legRiskColor,
  missionClockPosition,
  useMissionStore,
} from '../mission/missionStore';
import { buildTrack, positionAlongTrack, type TrackPoint, type Waypoint } from '../mission/route';
import type { WeatherCell } from '../mission/weather';
import { useSimStore } from '../state/store';
import styles from './MissionMap.module.css';

const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// The network style is the only part that can fail offline; a dark background
// layer keeps the canvas inside the console palette without a tile request.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'aerotwin-fallback-bg', type: 'background', paint: { 'background-color': '#0B0D10' } }],
};

const SRC = {
  legs: 'aerotwin-legs',
  waypoints: 'aerotwin-waypoints',
  trail: 'aerotwin-trail',
  uav: 'aerotwin-uav',
} as const;

const EMPTY_FC: FeatureCollection<LineString | Polygon> = { type: 'FeatureCollection', features: [] };

const LAYERS: LayerSpecification[] = [
  {
    id: 'aerotwin-legs-line',
    type: 'line',
    source: SRC.legs,
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.9 },
  },
  {
    id: 'aerotwin-trail-line',
    type: 'line',
    source: SRC.trail,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#5B8DB8', 'line-width': 1.5, 'line-opacity': 0.55 },
  },
  {
    id: 'aerotwin-waypoints-fill',
    type: 'fill',
    source: SRC.waypoints,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 1 },
  },
  {
    id: 'aerotwin-waypoints-line',
    type: 'line',
    source: SRC.waypoints,
    paint: { 'line-color': '#0B0D10', 'line-width': 1 },
  },
  {
    id: 'aerotwin-uav-fill',
    type: 'fill',
    source: SRC.uav,
    paint: { 'fill-color': '#5B8DB8', 'fill-opacity': 1 },
  },
  {
    id: 'aerotwin-uav-line',
    type: 'line',
    source: SRC.uav,
    paint: { 'line-color': '#0B0D10', 'line-width': 1 },
  },
];

const WP_HALF_PX = 4.5;
const UAV_SPAN_PX = 10;
const HIT_PX = 12;
const DRAG_START_PX = 3;
const TRAIL_M = 1000;
const TRAIL_SAMPLES = 12;
const BASEMAP_TIMEOUT_MS = 6000;
const FIT_PADDING_PX = 28;
const FIT_MAX_ZOOM = 10;

const DEG = Math.PI / 180;
const M_PER_DEG = 111320;
const NO_RISK: number[] = [];

export interface MissionMapProps {
  waypoints?: Waypoint[];
  weather?: WeatherCell[];
  /** Monte Carlo breach probability per leg; short or missing arrays read as zero risk. */
  legRisk?: number[];
  /** Mission clock, s. Ignored when mode is 'monitor', which reads the live twin. */
  clockS?: number | null;
  mode?: 'monitor' | 'review';
  showMarker?: boolean;
  height?: string;
  selectedId?: number | null;
  onSelected?: (id: number | null) => void;
}

function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos(lat * DEG)) / Math.pow(2, zoom);
}

function offset(lon: number, lat: number, eastM: number, northM: number): [number, number] {
  const scale = Math.max(0.05, Math.cos(lat * DEG));
  return [lon + eastM / (M_PER_DEG * scale), lat + northM / M_PER_DEG];
}

function squareRing(lon: number, lat: number, zoom: number): [number, number][] {
  const h = WP_HALF_PX * metersPerPixel(lat, zoom);
  const ring = [
    offset(lon, lat, -h, -h),
    offset(lon, lat, h, -h),
    offset(lon, lat, h, h),
    offset(lon, lat, -h, h),
  ];
  return [...ring, ring[0]];
}

/** Dart outline: [cross-track, forward] unit offsets rotated onto the leg bearing. */
function dartRing(lon: number, lat: number, bearingDeg: number, zoom: number): [number, number][] {
  const span = UAV_SPAN_PX * metersPerPixel(lat, zoom);
  const b = bearingDeg * DEG;
  const unit: [number, number][] = [
    [0, 1.15],
    [0.62, -0.7],
    [0, -0.3],
    [-0.62, -0.7],
  ];
  const ring = unit.map(([x, f]) =>
    offset(lon, lat, (f * Math.sin(b) + x * Math.cos(b)) * span, (f * Math.cos(b) - x * Math.sin(b)) * span),
  );
  return [...ring, ring[0]];
}

function legsFc(wps: Waypoint[], risk: number[]): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>['features'] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    features.push({
      type: 'Feature',
      properties: { color: legRiskColor(risk[i] ?? 0) },
      geometry: {
        type: 'LineString',
        coordinates: [
          [wps[i].lon, wps[i].lat],
          [wps[i + 1].lon, wps[i + 1].lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function squaresFc(wps: Waypoint[], zoom: number, selectedId: number | null): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>['features'] = [];
  for (const wp of wps) {
    features.push({
      type: 'Feature',
      properties: { color: wp.id === selectedId ? '#C9922E' : '#D7DEE7' },
      geometry: { type: 'Polygon', coordinates: [squareRing(wp.lon, wp.lat, zoom)] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function trailLine(track: TrackPoint[], distM: number): [number, number][] {
  if (track.length < 2 || distM <= 0) return [];
  const start = Math.max(0, distM - TRAIL_M);
  const pts: [number, number][] = [];
  for (let i = 0; i <= TRAIL_SAMPLES; i++) {
    const p = positionAlongTrack(track, start + ((distM - start) * i) / TRAIL_SAMPLES);
    if (p) pts.push([p.lon, p.lat]);
  }
  return pts;
}

function boundsOf(wps: Waypoint[]): [number, number, number, number] {
  let minLon = wps[0].lon;
  let maxLon = wps[0].lon;
  let minLat = wps[0].lat;
  let maxLat = wps[0].lat;
  for (const w of wps) {
    minLon = Math.min(minLon, w.lon);
    maxLon = Math.max(maxLon, w.lon);
    minLat = Math.min(minLat, w.lat);
    maxLat = Math.max(maxLat, w.lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

const WORLD_PX = 512; // Web Mercator world width at zoom 0

function mercatorY(latDeg: number): number {
  const s = Math.sin(Math.max(-85.05, Math.min(85.05, latDeg)) * DEG);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/**
 * Centre and zoom that frame the route. MapLibre's own fitBounds is not used:
 * when the bounds cannot fit the canvas it warns and hands back no camera, and
 * the constructor then dereferences it. The narrow Live Monitor strip and a
 * multi-degree route hit exactly that case.
 */
function fitForWps(
  wps: Waypoint[],
  widthPx: number,
  heightPx: number,
): { center: [number, number]; zoom: number } {
  const [minLon, minLat, maxLon, maxLat] = boundsOf(wps);
  const spanX = (Math.max(1e-6, maxLon - minLon) / 360) * WORLD_PX;
  const spanY = Math.max(1e-6, mercatorY(minLat) - mercatorY(maxLat)) * WORLD_PX;
  const availW = Math.max(1, widthPx - 2 * FIT_PADDING_PX);
  const availH = Math.max(1, heightPx - 2 * FIT_PADDING_PX);
  const zoom = Math.min(Math.log2(availW / spanX), Math.log2(availH / spanY), FIT_MAX_ZOOM);
  return { center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2], zoom: Math.max(1, zoom) };
}

function hitWaypoint(map: MaplibreMap, x: number, y: number, wps: Waypoint[]): number | null {
  let best: number | null = null;
  let bestDist = HIT_PX;
  for (const wp of wps) {
    const p = map.project([wp.lon, wp.lat]);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = wp.id;
    }
  }
  return best;
}

function fmtClock(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function MissionMap({
  waypoints: waypointsProp,
  weather: weatherProp,
  legRisk,
  clockS = null,
  mode = 'review',
  showMarker = true,
  height = '100%',
  selectedId,
  onSelected,
}: MissionMapProps) {
  const storeWaypoints = useMissionStore((s) => s.waypoints);
  const storeWeather = useMissionStore((s) => s.weather);
  const storeLegs = useMissionStore((s) => s.mcResult?.legs);
  const waypoints = waypointsProp ?? storeWaypoints;
  const weather = weatherProp ?? storeWeather;
  const risk = legRisk ?? (storeLegs ? storeLegs.map((l) => l.breachFrac) : NO_RISK);

  const monitor = mode === 'monitor';
  const liveT = useSimStore((s) => (monitor ? (s.snapshot?.t ?? 0) : 0));

  const [internalSelected, setInternalSelected] = useState<number | null>(null);
  const [basemapDown, setBasemapDown] = useState(false);
  const controlled = selectedId !== undefined;
  const selected = controlled ? (selectedId ?? null) : internalSelected;

  const select = useCallback(
    (id: number | null) => {
      if (!controlled) setInternalSelected(id);
      onSelected?.(id);
    },
    [controlled, onSelected],
  );

  const plan = useMemo(() => currentPlan(waypoints, weather), [waypoints, weather]);
  const track = useMemo(() => buildTrack(waypoints), [waypoints]);
  const clock = monitor ? liveT : clockS;
  // positionAtClock wraps on the plan period, so an exact totalS would put the
  // aircraft back at the start; stop just short of the end so a scrub parks it.
  const endClock = plan.totalS > 0 ? plan.totalS - 1e-3 : 0;
  const clampedClock = clock === null || clock === undefined ? null : Math.max(0, Math.min(clock, endClock));
  const cp = useMemo(
    () =>
      showMarker && clampedClock !== null && waypoints.length > 1
        ? missionClockPosition(waypoints, weather, clampedClock)
        : null,
    [showMarker, clampedClock, waypoints, weather],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const labelsRef = useRef<Map<number, MaplibreMarker>>(new Map());
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const clickGuardRef = useRef(false);
  const readyRef = useRef(false);
  const countRef = useRef(waypoints.length);
  const dataRef = useRef({ waypoints, risk, track, selected, cp });
  dataRef.current = { waypoints, risk, track, selected, cp };
  const selectRef = useRef(select);
  selectRef.current = select;

  const pushAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const d = dataRef.current;
    const zoom = map.getZoom();
    const src = (id: string): GeoJSONSource | undefined => map.getSource(id) as GeoJSONSource | undefined;
    src(SRC.legs)?.setData(legsFc(d.waypoints, d.risk));
    src(SRC.waypoints)?.setData(squaresFc(d.waypoints, zoom, d.selected));
    src(SRC.trail)?.setData({
      type: 'FeatureCollection',
      features: d.cp
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: trailLine(d.track, d.cp.distM) },
            },
          ]
        : [],
    });
    src(SRC.uav)?.setData({
      type: 'FeatureCollection',
      features: d.cp
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [dartRing(d.cp.lon, d.cp.lat, d.cp.bearingDeg, zoom)],
              },
            },
          ]
        : [],
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ensureOverlays = () => {
      for (const id of Object.values(SRC)) {
        if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
      }
      for (const layer of LAYERS) {
        if (!map.getLayer(layer.id)) map.addLayer(layer);
      }
      readyRef.current = true;
    };

    const map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE_URL,
      attributionControl: false,
      maxPitch: 0,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      cooperativeGestures: false,
      hash: false,
      ...(waypoints.length >= 2
        ? fitForWps(waypoints, container.clientWidth, container.clientHeight)
        : {}),
    });
    mapRef.current = map;

    let styleLoaded = false;
    let fallback = false;
    let attribution: AttributionControlInstance | null = null;

    // A fallback style carries no source attribution, so the CARTO/OSM credit
    // moves onto the control itself when the basemap never arrives.
    const setAttribution = (isFallback: boolean) => {
      if (attribution) map.removeControl(attribution);
      attribution = new maplibregl.AttributionControl({
        compact: false,
        customAttribution: isFallback ? '© CARTO · © OpenStreetMap contributors' : undefined,
      });
      map.addControl(attribution, 'bottom-right');
    };

    const goFallback = () => {
      if (fallback || styleLoaded) return;
      fallback = true;
      readyRef.current = false;
      setBasemapDown(true);
      map.setStyle(FALLBACK_STYLE);
      setAttribution(true);
    };

    const onLoad = () => {
      styleLoaded = true;
      ensureOverlays();
      pushAll();
      if (!fallback) setAttribution(false);
    };
    const onStyleData = () => {
      if (map.isStyleLoaded()) {
        ensureOverlays();
        pushAll();
      }
    };
    const onMove = () => pushAll();
    const onError = () => goFallback();

    map.on('load', onLoad);
    map.on('styledata', onStyleData);
    map.on('move', onMove);
    map.on('error', onError);
    const timer = window.setTimeout(goFallback, BASEMAP_TIMEOUT_MS);

    const onDown = (e: MapMouseEvent) => {
      // MapLibre suppresses the click that follows a drag, so the guard is
      // cleared at every press instead of waiting to be consumed by a click.
      clickGuardRef.current = false;
      const id = hitWaypoint(map, e.point.x, e.point.y, dataRef.current.waypoints);
      if (id === null) return;
      dragRef.current = { id, x: e.point.x, y: e.point.y, moved: false };
      map.dragPan.disable();
      selectRef.current(id);
      container.focus();
    };
    const onDrag = (e: MapMouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.point.x - d.x, e.point.y - d.y) < DRAG_START_PX) return;
      d.moved = true;
      useMissionStore.getState().moveWaypoint(d.id, e.lngLat.lat, e.lngLat.lng);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      map.dragPan.enable();
      if (d?.moved) clickGuardRef.current = true;
    };
    const onClick = (e: MapMouseEvent) => {
      if (clickGuardRef.current) {
        clickGuardRef.current = false;
        return;
      }
      const id = hitWaypoint(map, e.point.x, e.point.y, dataRef.current.waypoints);
      if (id !== null) {
        selectRef.current(id);
        return;
      }
      useMissionStore.getState().addWaypoint(e.lngLat.lat, e.lngLat.lng);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      const id = dataRef.current.selected;
      if (id === null) return;
      ev.preventDefault();
      useMissionStore.getState().deleteWaypoint(id);
      selectRef.current(null);
    };
    // A release outside the canvas never reaches the map, which would leave
    // drag pan switched off for the rest of the session.
    const onDocUp = () => {
      if (dragRef.current) onUp();
    };

    map.on('mousedown', onDown);
    map.on('mousemove', onDrag);
    map.on('mouseup', onUp);
    map.on('click', onClick);
    container.addEventListener('keydown', onKey);
    document.addEventListener('mouseup', onDocUp);

    return () => {
      window.clearTimeout(timer);
      map.off('load', onLoad);
      map.off('styledata', onStyleData);
      map.off('move', onMove);
      map.off('error', onError);
      map.off('mousedown', onDown);
      map.off('mousemove', onDrag);
      map.off('mouseup', onUp);
      map.off('click', onClick);
      container.removeEventListener('keydown', onKey);
      document.removeEventListener('mouseup', onDocUp);
      for (const marker of labelsRef.current.values()) marker.remove();
      labelsRef.current.clear();
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // The map is built once; every later change is pushed through refs.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visible = new Set<number>();
    for (const wp of waypoints) {
      visible.add(wp.id);
      const text = `${wp.name} ${Math.round(wp.altM)}`;
      let marker = labelsRef.current.get(wp.id);
      if (!marker) {
        const el = document.createElement('div');
        el.className = styles.label;
        marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [9, 0] });
        // A marker added without a position updates against an undefined lngLat.
        marker.setLngLat([wp.lon, wp.lat]);
        marker.addTo(map);
        labelsRef.current.set(wp.id, marker);
      }
      marker.setLngLat([wp.lon, wp.lat]);
      const el = marker.getElement();
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle(styles.sel, wp.id === selected);
    }
    for (const [id, marker] of labelsRef.current) {
      if (!visible.has(id)) {
        marker.remove();
        labelsRef.current.delete(id);
      }
    }
  }, [waypoints, selected]);

  useEffect(() => {
    pushAll();
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!map || waypoints.length === countRef.current || waypoints.length < 2) return;
    countRef.current = waypoints.length;
    const size = map.getContainer();
    map.jumpTo(fitForWps(waypoints, size.clientWidth, size.clientHeight));
  }, [waypoints]);

  const sel = useMemo(() => waypoints.find((w) => w.id === selected) ?? null, [waypoints, selected]);
  const legCount = Math.max(waypoints.length - 1, 1);

  return (
    <div ref={containerRef} className={styles.wrap} style={{ height }} tabIndex={0}>
      <div className={styles.hud}>
        {basemapDown ? <span>MAP BASEMAP UNAVAILABLE - ROUTE DRAWN ON VECTOR FALLBACK</span> : null}
        {cp && clampedClock !== null ? (
          <span>{`T+${fmtClock(clampedClock)} - ${cp.kind.toUpperCase()} - LEG ${cp.legIndex + 1}/${legCount}`}</span>
        ) : null}
        {sel ? (
          <span className={sel.id === selected ? styles.sel : undefined}>
            {`SEL ${sel.name} ${Math.round(sel.altM)}M - ${sel.lat.toFixed(4)} ${sel.lon.toFixed(4)} - DEL REMOVES`}
          </span>
        ) : null}
      </div>
    </div>
  );
}
