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
  Popup as MaplibrePopup,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import {
  currentPlan,
  legRiskColor,
  missionClockPosition,
  useMissionStore,
} from '../mission/missionStore';
import { buildTrack, positionAlongTrack, type TrackPoint, type Waypoint } from '../mission/route';
import type { WeatherCell } from '../mission/weather';
import { useSimStore } from '../state/store';
import { AIRFIELDS, type Airfield } from '../data/airfields';
import { PLACES } from '../data/places';
import { activeAirfields, airfieldRole, useAlternates } from '../nav/useAlternates';
import type { AlternateRow } from '../nav/alternates';
import { fmtAltM, fmtBrg, fmtDistKm, fmtHms } from '../nav/units';
import styles from './MissionMap.module.css';

const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// The network style is the only part that can fail offline; a dark background
// layer keeps the canvas inside the console palette without a tile request.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'aerotwin-fallback-bg', type: 'background', paint: { 'background-color': '#0B0D10' } }],
};

// Opening camera: the subcontinent. Choosing a preset flies to its own bounds.
const INDIA_VIEW = { center: [79, 22] as [number, number], zoom: 4.2 };

// Country-level and disputed-boundary layers are switched off when the basemap
// arrives; state and county lines stay. No boundary is drawn by us.
const BORDER_LAYER_RE = /(country|border|disputed|breakaway|maritime)/i;

const BG1 = '#11151A';
const STEEL = '#5B8DB8';
const AMBER = '#C9922E';
const RED = '#C4443F';
const GREY = '#93A0B0';
const TXT = '#D7DEE7';

const SRC = {
  legs: 'aerotwin-legs',
  waypoints: 'aerotwin-waypoints',
  trail: 'aerotwin-trail',
  uav: 'aerotwin-uav',
  airfields: 'aerotwin-airfields',
  places: 'aerotwin-places',
  divert: 'aerotwin-divert',
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
    id: 'aerotwin-divert-line',
    type: 'line',
    source: SRC.divert,
    layout: { 'line-cap': 'butt' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.95 },
  },
  {
    id: 'aerotwin-trail-line',
    type: 'line',
    source: SRC.trail,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': STEEL, 'line-width': 1.5, 'line-opacity': 0.55 },
  },
  {
    id: 'aerotwin-places-circle',
    type: 'circle',
    source: SRC.places,
    paint: {
      'circle-radius': 1.5,
      'circle-color': GREY,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5.5, 0, 6, 0.9],
    },
  },
  {
    id: 'aerotwin-airfields-fill',
    type: 'fill',
    source: SRC.airfields,
    paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 1 },
  },
  {
    id: 'aerotwin-airfields-line',
    type: 'line',
    source: SRC.airfields,
    paint: { 'line-color': ['get', 'stroke'], 'line-width': 1 },
  },
  {
    id: 'aerotwin-waypoints-fill',
    type: 'fill',
    source: SRC.waypoints,
    paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 1 },
  },
  {
    id: 'aerotwin-waypoints-line',
    type: 'line',
    source: SRC.waypoints,
    paint: { 'line-color': BG1, 'line-width': 1 },
  },
  {
    id: 'aerotwin-uav-fill',
    type: 'fill',
    source: SRC.uav,
    paint: { 'fill-color': STEEL, 'fill-opacity': 1 },
  },
  {
    id: 'aerotwin-uav-line',
    type: 'line',
    source: SRC.uav,
    paint: { 'line-color': BG1, 'line-width': 1 },
  },
];

const WP_HALF_PX = 4.5;
const AF_HALF_PX = 4;
const UAV_SPAN_PX = 10;
const HIT_PX = 12;
const DRAG_START_PX = 3;
const TRAIL_M = 1000;
const TRAIL_SAMPLES = 12;
const BASEMAP_TIMEOUT_MS = 6000;
const FIT_PADDING_PX = 28;
const FIT_MAX_ZOOM = 10;
/** Reference places stay off the canvas until the camera is close enough to read. */
const PLACE_LABEL_MIN_ZOOM = 6;
/** Keep a divert label this far inside the canvas edge when clipping it. */
const LABEL_PAD_PX = 24;

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

function squareRing(lon: number, lat: number, zoom: number, halfPx: number): [number, number][] {
  const h = halfPx * metersPerPixel(lat, zoom);
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

function squaresFc(
  items: { lat: number; lon: number }[],
  zoom: number,
  halfPx: number,
  fillOf: (index: number) => string,
  strokeOf: (index: number) => string,
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: items.map((it, i) => ({
      type: 'Feature',
      properties: { fill: fillOf(i), stroke: strokeOf(i) },
      geometry: { type: 'Polygon', coordinates: [squareRing(it.lon, it.lat, zoom, halfPx)] },
    })),
  };
}

function placesFc(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: PLACES.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
}

function verdictColor(verdict: AlternateRow['verdict']): string {
  return verdict === 'REACHABLE' ? STEEL : verdict === 'MARGINAL' ? AMBER : RED;
}

function divertFc(from: { lat: number; lon: number } | null, row: AlternateRow | null): FeatureCollection<LineString> {
  if (!from || !row) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { color: verdictColor(row.verdict) },
        geometry: {
          type: 'LineString',
          coordinates: [
            [from.lon, from.lat],
            [row.airfield.lon, row.airfield.lat],
          ],
        },
      },
    ],
  };
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

/**
 * Midpoint of the part of a line the camera can actually see, as a geographic
 * point. A divert line to an alternate 250 km away runs off the canvas, and a
 * label at the true midpoint would sit outside the view; clipping to the
 * visible span (Liang-Barsky) keeps the label on the line where it is drawn.
 * Null when the segment is entirely off screen, which the caller reads as
 * "no line to label".
 */
function visibleMid(
  map: MaplibreMap,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): [number, number] | null {
  const el = map.getContainer();
  const w = el.clientWidth;
  const h = el.clientHeight;
  const p0 = map.project([a.lon, a.lat]);
  const p1 = map.project([b.lon, b.lat]);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const pf = [-dx, dx, -dy, dy];
  const qf = [p0.x - LABEL_PAD_PX, w - LABEL_PAD_PX - p0.x, p0.y - LABEL_PAD_PX, h - LABEL_PAD_PX - p0.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (pf[i] === 0) {
      if (qf[i] < 0) return null;
      continue;
    }
    const r = qf[i] / pf[i];
    if (pf[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t1 - t0 < 1e-6) return null;
  const t = (t0 + t1) / 2;
  const ll = map.unproject([p0.x + dx * t, p0.y + dy * t]);
  return [ll.lng, ll.lat];
}

/** Index of the closest item to a canvas point within the hit radius, or -1. */
function hitIndex<T extends { lat: number; lon: number }>(
  map: MaplibreMap,
  x: number,
  y: number,
  items: T[],
): number {
  let best = -1;
  let bestDist = HIT_PX;
  for (let i = 0; i < items.length; i++) {
    const p = map.project([items[i].lon, items[i].lat]);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
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

/** Flat airfield detail card, built from DOM nodes so no markup is interpreted. */
function showAirfieldPopup(
  popupRef: { current: MaplibrePopup | null },
  map: MaplibreMap,
  af: Airfield,
): void {
  const body = document.createElement('div');
  body.className = styles.pop;
  const addRow = (key: string, value: string) => {
    const row = document.createElement('div');
    row.className = styles.popRow;
    const k = document.createElement('span');
    k.className = styles.popKey;
    k.textContent = key;
    const v = document.createElement('span');
    v.className = styles.popValue;
    v.textContent = value;
    row.append(k, v);
    body.append(row);
  };
  addRow('NAME', af.name);
  addRow('CITY', af.city);
  addRow('STATE', af.state);
  addRow('ICAO', af.icao);
  addRow('ELEV', fmtAltM(af.elevationM));
  popupRef.current?.remove();
  const popup = new maplibregl.Popup({ className: styles.popup, offset: 8, maxWidth: '280px' })
    .setLngLat([af.lon, af.lat])
    .setDOMContent(body)
    .addTo(map);
  popup.on('close', () => {
    if (popupRef.current === popup) popupRef.current = null;
  });
  popupRef.current = popup;
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
  const presetId = useMissionStore((s) => s.routePresetId);
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
  const fields = useMemo(() => activeAirfields(presetId, waypoints), [presetId, waypoints]);
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
  // Alternates are evaluated where the aircraft is; before a run is clocked the
  // route start is the best available position.
  const pos = useMemo(
    () =>
      cp
        ? { lat: cp.lat, lon: cp.lon, legIndex: cp.legIndex }
        : waypoints.length
          ? { lat: waypoints[0].lat, lon: waypoints[0].lon, legIndex: 0 }
          : null,
    [cp, waypoints],
  );
  const nav = useAlternates(pos, fields);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const labelsRef = useRef<Map<number, MaplibreMarker>>(new Map());
  const afLabelsRef = useRef<Map<string, MaplibreMarker>>(new Map());
  const placeLabelsRef = useRef<MaplibreMarker[]>([]);
  const divertLabelRef = useRef<MaplibreMarker | null>(null);
  const popupRef = useRef<MaplibrePopup | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const clickGuardRef = useRef(false);
  const readyRef = useRef(false);
  const viewRef = useRef({ presetId, count: waypoints.length });
  const dataRef = useRef({ waypoints, risk, track, selected, cp, nav, pos, presetId });
  dataRef.current = { waypoints, risk, track, selected, cp, nav, pos, presetId };
  const selectRef = useRef(select);
  selectRef.current = select;

  const pushAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const d = dataRef.current;
    const zoom = map.getZoom();
    const src = (id: string): GeoJSONSource | undefined => map.getSource(id) as GeoJSONSource | undefined;
    src(SRC.legs)?.setData(legsFc(d.waypoints, d.risk));
    src(SRC.waypoints)?.setData(
      squaresFc(
        d.waypoints,
        zoom,
        WP_HALF_PX,
        (i) => (d.waypoints[i].id === d.selected ? AMBER : TXT),
        () => BG1,
      ),
    );
    src(SRC.airfields)?.setData(
      squaresFc(
        AIRFIELDS,
        zoom,
        AF_HALF_PX,
        (i) => (airfieldRole(d.presetId, AIRFIELDS[i].icao) === 'home' ? STEEL : BG1),
        (i) => {
          const role = airfieldRole(d.presetId, AIRFIELDS[i].icao);
          return role === 'home' || role === 'dest' ? STEEL : GREY;
        },
      ),
    );
    src(SRC.places)?.setData(placesFc());
    // The divert line points at the nearest alternate: what the crew would fly.
    const line = d.nav.alert ? d.nav.nearest : null;
    src(SRC.divert)?.setData(divertFc(d.pos, line));
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
    const showPlaces = zoom >= PLACE_LABEL_MIN_ZOOM;
    for (const marker of placeLabelsRef.current) {
      const el = marker.getElement();
      if (showPlaces === (el.style.display === 'none')) el.style.display = showPlaces ? '' : 'none';
    }
    const dl = divertLabelRef.current;
    if (dl) {
      const el = dl.getElement();
      const mid = line && d.pos ? visibleMid(map, d.pos, line.airfield) : null;
      if (mid && line) {
        dl.setLngLat(mid);
        const text = `${fmtDistKm(line.distM)} - ETE ${fmtHms(line.eteS)} - ${line.mode} - ${line.verdict}`;
        if (el.textContent !== text) el.textContent = text;
        if (el.style.display === 'none') el.style.display = '';
      } else if (el.style.display !== 'none') {
        el.style.display = 'none';
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The visibility test keeps this idempotent, so the styledata handler that
    // setLayoutProperty provokes cannot re-enter forever.
    const hideBorders = () => {
      for (const layer of map.getStyle().layers) {
        if (!BORDER_LAYER_RE.test(layer.id)) continue;
        if (map.getLayoutProperty(layer.id, 'visibility') === 'none') continue;
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    };

    const ensureOverlays = () => {
      hideBorders();
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
      ...INDIA_VIEW,
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

    const hitWp = (e: MapMouseEvent): number | null => {
      const i = hitIndex(map, e.point.x, e.point.y, dataRef.current.waypoints);
      return i < 0 ? null : dataRef.current.waypoints[i].id;
    };
    const onDown = (e: MapMouseEvent) => {
      // MapLibre suppresses the click that follows a drag, so the guard is
      // cleared at every press instead of waiting to be consumed by a click.
      clickGuardRef.current = false;
      const wp = hitWp(e);
      if (wp === null) return;
      dragRef.current = { id: wp, x: e.point.x, y: e.point.y, moved: false };
      map.dragPan.disable();
      selectRef.current(wp);
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
      const wp = hitWp(e);
      if (wp !== null) {
        selectRef.current(wp);
        return;
      }
      const af = hitIndex(map, e.point.x, e.point.y, AIRFIELDS);
      if (af >= 0) {
        showAirfieldPopup(popupRef, map, AIRFIELDS[af]);
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
      for (const marker of afLabelsRef.current.values()) marker.remove();
      afLabelsRef.current.clear();
      for (const marker of placeLabelsRef.current) marker.remove();
      placeLabelsRef.current = [];
      divertLabelRef.current?.remove();
      divertLabelRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // The map is built once; every later change is pushed through refs.
  }, []);

  // Waypoint name/altitude tags, ICAO tags and the divert-line label.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visible = new Set<number>();
    for (const wp of waypoints) {
      visible.add(wp.id);
      const text = `${wp.name} ${fmtAltM(wp.altM)}`;
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
    for (const af of AIRFIELDS) {
      const role = airfieldRole(presetId, af.icao);
      let marker = afLabelsRef.current.get(af.icao);
      if (!marker) {
        const el = document.createElement('div');
        el.className = `${styles.label} ${styles.af}`;
        marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [7, 0] });
        marker.setLngLat([af.lon, af.lat]);
        marker.addTo(map);
        afLabelsRef.current.set(af.icao, marker);
      }
      const el = marker.getElement();
      if (el.textContent !== af.icao) el.textContent = af.icao;
      el.classList.toggle(styles.afRole, role === 'home' || role === 'dest');
    }
    if (!divertLabelRef.current) {
      const el = document.createElement('div');
      el.className = styles.divert;
      el.style.display = 'none';
      // A marker added without a position updates against an undefined lngLat.
      const at = dataRef.current.pos ?? { lat: INDIA_VIEW.center[1], lon: INDIA_VIEW.center[0] };
      divertLabelRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([at.lon, at.lat])
        .addTo(map);
    }
  }, [waypoints, selected, presetId]);

  // Reference places: the dots come from the layer, the labels only once the
  // camera is close enough to read them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || placeLabelsRef.current.length) return;
    placeLabelsRef.current = PLACES.map((p) => {
      const el = document.createElement('div');
      el.className = `${styles.label} ${styles.place}`;
      el.textContent = p.name;
      el.style.display = 'none';
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [5, 0] })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
    });
  }, []);

  useEffect(() => {
    pushAll();
  });

  // A preset choice flies to its region; adding or removing waypoints re-frames
  // in place. The opening camera stays on the India overview.
  useEffect(() => {
    const map = mapRef.current;
    const v = viewRef.current;
    if (!map || waypoints.length < 2) return;
    const presetChanged = v.presetId !== presetId;
    const countChanged = v.count !== waypoints.length;
    if (!presetChanged && !countChanged) return;
    v.presetId = presetId;
    v.count = waypoints.length;
    const size = map.getContainer();
    const target = fitForWps(waypoints, size.clientWidth, size.clientHeight);
    if (presetChanged) map.flyTo({ ...target, duration: 1400 });
    else map.jumpTo(target);
  }, [waypoints, presetId]);

  const sel = useMemo(() => waypoints.find((w) => w.id === selected) ?? null, [waypoints, selected]);
  const legCount = Math.max(waypoints.length - 1, 1);
  const nearest = nav.nearest;
  const noneReachable = nav.alert && nav.rows.length > 0 && !nav.reachable;

  return (
    <div ref={containerRef} className={styles.wrap} style={{ height }} tabIndex={0}>
      <div className={styles.hud}>
        {basemapDown ? <span>MAP BASEMAP UNAVAILABLE - ROUTE DRAWN ON VECTOR FALLBACK</span> : null}
        {cp && clampedClock !== null ? (
          <span>{`T+${fmtClock(clampedClock)} - ${cp.kind.toUpperCase()} - LEG ${cp.legIndex + 1}/${legCount}`}</span>
        ) : null}
        {sel ? (
          <span className={sel.id === selected ? styles.sel : undefined}>
            {`SEL ${sel.name} ${fmtAltM(sel.altM)} - ${sel.lat.toFixed(4)} ${sel.lon.toFixed(4)} - DEL REMOVES`}
          </span>
        ) : null}
      </div>
      {nearest ? (
        <div className={styles.navcard}>
          <div className={styles.navHead}>
            {`NEAREST ALTERNATE ${nearest.airfield.icao} ${nearest.airfield.city.toUpperCase()}`}
          </div>
          <div>{`BRG ${fmtBrg(nearest.bearingDeg)} - DIST ${fmtDistKm(nearest.distM)}`}</div>
          <div>{`ETE ${fmtHms(nearest.eteS)} - ${nearest.mode} - ${nearest.verdict}`}</div>
          {nearest.verdict === 'MARGINAL' || nearest.verdict === 'NOT REACHABLE' ? (
            <div className={nearest.verdict === 'MARGINAL' ? styles.warn : styles.crit}>
              {`LIMITING FACTOR ${nearest.limiting}`}
            </div>
          ) : null}
          {nearest.verdict === 'NOT REACHABLE' && nav.reachable ? (
            <div className={styles.ok}>
              {`NEAREST REACHABLE ${nav.reachable.airfield.icao} ${nav.reachable.airfield.city.toUpperCase()} - ${fmtDistKm(nav.reachable.distM)} - ETE ${fmtHms(nav.reachable.eteS)}`}
            </div>
          ) : null}
          {noneReachable ? <div className={styles.crit}>NO REACHABLE ALTERNATE</div> : null}
        </div>
      ) : null}
      <div className={styles.note}>Illustrative map. Boundaries not depicted.</div>
    </div>
  );
}
