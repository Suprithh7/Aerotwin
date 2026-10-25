import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { currentPlan, missionClockPosition, useMissionStore } from '../../mission/missionStore';
import { positionAtClock } from '../../mission/mission';
import { distanceM, type Waypoint } from '../../mission/route';
import type { Mission } from '../../mission/types';
import type { WeatherCell } from '../../mission/weather';
import { circleRing, legMidpoint } from '../../mission/geometry';
import { MAX_LINK_RANGE_KM } from '../../payload/link';
import { AIRFIELDS } from '../../data/airfields';
import { C } from '../../ui/theme';
import styles from './RehearsalMap.module.css';

const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'aerotwin-fallback-bg', type: 'background', paint: { 'background-color': C.bg } }],
};

const BASEMAP_TIMEOUT_MS = 6000;
const FIT_MAX_ZOOM = 10;
const WORLD_PX = 512;
const DEG = Math.PI / 180;
const CLICK_TO_VERTEX_MS = 220;

const SRC = {
  route: 'aerotwin-route',
  flown: 'aerotwin-flown',
  zones: 'aerotwin-zones',
  draft: 'aerotwin-draft-zone',
  ring: 'aerotwin-link-ring',
  aircraft: 'aerotwin-aircraft',
  airports: 'aerotwin-airports',
  dem: 'aerotwin-dem',
} as const;

const LAYER = {
  zoneFill: 'aerotwin-zone-fill',
  zoneLine: 'aerotwin-zone-line',
  draftFill: 'aerotwin-draft-fill',
  draftLine: 'aerotwin-draft-line',
  ringLine: 'aerotwin-ring-line',
  routeCasing: 'aerotwin-route-casing',
  routeLine: 'aerotwin-route-line',
  flown: 'aerotwin-flown-line',
  chevrons: 'aerotwin-route-chevrons',
  chevronIcon: 'aerotwin-chevron-icon',
  airportIcon: 'aerotwin-airport-icon',
  airports: 'aerotwin-airport-symbols',
  airportsMinor: 'aerotwin-airport-symbols-minor',
  aircraft: 'aerotwin-aircraft-dot',
  hillshade: 'aerotwin-hillshade',
  hatch: 'aerotwin-denied-hatch',
} as const;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const AIRPORTS_FC: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: AIRFIELDS.map((a) => ({
    type: 'Feature',
    properties: { type: a.type, icao: a.icao },
    geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
  })),
};

const LABEL_CH_PX = 7.2;

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RehearsalMapProps {
  mission: Mission;
  /** Mission nodes resolved to AMSL waypoints. */
  waypoints: Waypoint[];
  weather: WeatherCell[];
  /** Mission clock, s; shows the aircraft marker only when not null. */
  clockS?: number | null;
  showMarker?: boolean;
  /** Enables click-to-add, node/site/ground dragging, insert handles and zones. */
  editor?: boolean;
  fitPadding?: FitPadding;
  height?: string;
}

interface LabelEntry {
  marker: MaplibreMarker;
  el: HTMLElement;
  lat: number;
  lon: number;
  dx: number;
  align: 'left' | 'right';
}

function hideBaseChrome(map: MaplibreMap): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith('aerotwin')) continue;
    // Keep only the land and water fills; every base line and symbol layer —
    // including administrative boundaries, roads and place labels — is removed
    // so the chart carries our own chrome and no national borders.
    if (layer.type === 'background' || layer.type === 'fill' || layer.type === 'raster') continue;
    if (map.getLayoutProperty(layer.id, 'visibility') === 'none') continue;
    map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
}

function addHillshade(map: MaplibreMap): void {
  if (!map.getSource(SRC.dem)) {
    map.addSource(SRC.dem, {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 12,
      attribution: 'Terrain © Mapzen / AWS',
    });
  }
  if (!map.getLayer(LAYER.hillshade)) {
    map.addLayer({
      id: LAYER.hillshade,
      type: 'hillshade',
      source: SRC.dem,
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': 'rgba(0, 0, 0, 0.55)',
        'hillshade-highlight-color': 'rgba(76, 88, 102, 0.28)',
        'hillshade-accent-color': 'rgba(35, 42, 51, 0.35)',
      },
    } as LayerSpecification);
  }
  if (!map.getTerrain()) map.setTerrain({ source: SRC.dem, exaggeration: 0.5 });
}

function addDeniedPattern(map: MaplibreMap): void {
  if (map.hasImage(LAYER.hatch)) return;
  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = C.critical;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2, size + 2);
  ctx.lineTo(size + 2, -2);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, size, size);
  map.addImage(LAYER.hatch, img);
}

/** Direction chevron as an icon: no glyph stack is needed, so the fallback
 * style (which has no glyphs URL) can still draw the route direction. */
function addChevronIcon(map: MaplibreMap): void {
  if (map.hasImage(LAYER.chevronIcon)) return;
  const size = 14;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = C.route;
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(4, 2);
  ctx.lineTo(10, 7);
  ctx.lineTo(4, 12);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, size, size);
  map.addImage(LAYER.chevronIcon, img, { pixelRatio: 1 });
}

/** Aerodrome symbol: blue disc with a paper runway bar. */
function addAirportIcon(map: MaplibreMap): void {
  if (map.hasImage(LAYER.airportIcon)) return;
  const size = 28;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = C.airport;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.sheet;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(8.5, 17.5);
  ctx.lineTo(19.5, 10.5);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, size, size);
  map.addImage(LAYER.airportIcon, img, { pixelRatio: 2 });
}

const OVERLAY_LAYERS: LayerSpecification[] = [
  {
    id: LAYER.zoneFill,
    type: 'fill',
    source: SRC.zones,
    paint: { 'fill-pattern': LAYER.hatch, 'fill-opacity': 0.18 },
  },
  {
    id: LAYER.zoneLine,
    type: 'line',
    source: SRC.zones,
    paint: {
      'line-color': C.critical,
      'line-width': 1,
      'line-opacity': 0.55,
      'line-dasharray': [3, 2],
    },
  },
  {
    id: LAYER.draftFill,
    type: 'fill',
    source: SRC.draft,
    paint: { 'fill-color': C.critical, 'fill-opacity': 0.1 },
  },
  {
    id: LAYER.draftLine,
    type: 'line',
    source: SRC.draft,
    paint: { 'line-color': C.critical, 'line-width': 1, 'line-dasharray': [3, 2] },
  },
  {
    id: LAYER.ringLine,
    type: 'line',
    source: SRC.ring,
    paint: { 'line-color': C.ink3, 'line-width': 1, 'line-opacity': 0.55, 'line-dasharray': [5, 5] },
  },
  {
    id: LAYER.routeCasing,
    type: 'line',
    source: SRC.route,
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: { 'line-color': C.bg, 'line-width': 6, 'line-opacity': 0.92 },
  },
  {
    id: LAYER.routeLine,
    type: 'line',
    source: SRC.route,
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: { 'line-color': C.route, 'line-width': 2, 'line-opacity': 0.95 },
  },
  {
    id: LAYER.chevrons,
    type: 'symbol',
    source: SRC.route,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 72,
      'icon-image': LAYER.chevronIcon,
      'icon-size': 1,
      'icon-rotation-alignment': 'map',
      'icon-keep-upright': false,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  },
  {
    id: LAYER.flown,
    type: 'line',
    source: SRC.flown,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.activeTrack, 'line-width': 2 },
  },
  {
    id: LAYER.airports,
    type: 'symbol',
    source: SRC.airports,
    filter: [
      'any',
      ['==', ['get', 'type'], 'large_airport'],
      ['==', ['get', 'type'], 'medium_airport'],
    ],
    layout: { 'icon-image': LAYER.airportIcon, 'icon-size': 1, 'icon-allow-overlap': false },
  },
  {
    id: LAYER.airportsMinor,
    type: 'symbol',
    source: SRC.airports,
    minzoom: 7.2,
    filter: [
      'any',
      ['==', ['get', 'type'], 'small_airport'],
      ['==', ['get', 'type'], 'heliport'],
    ],
    layout: { 'icon-image': LAYER.airportIcon, 'icon-size': 0.8, 'icon-allow-overlap': false },
  },
  {
    id: LAYER.aircraft,
    type: 'circle',
    source: SRC.aircraft,
    paint: {
      'circle-radius': 4.5,
      'circle-color': C.activeTrack,
      'circle-stroke-color': C.bg,
      'circle-stroke-width': 2,
    },
  },
];

function layoutLabels(map: MaplibreMap, entries: LabelEntry[], waypoints: Waypoint[]): void {
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const width = map.getContainer().clientWidth;
  const height = map.getContainer().clientHeight;

  // Numbered waypoint dots are collision anchors too: a place label must not
  // sit on top of one.
  for (const w of waypoints) {
    const p = map.project([w.lon, w.lat]);
    boxes.push({ x0: p.x - 12, y0: p.y - 12, x1: p.x + 12, y1: p.y + 12 });
  }

  for (const e of entries) {
    if (e.el.style.display === 'none') continue;
    const p = map.project([e.lon, e.lat]);
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
      if (e.el.style.visibility !== 'hidden') e.el.style.visibility = 'hidden';
      continue;
    }
    if (e.el.style.visibility === 'hidden') e.el.style.visibility = '';

    const w = Math.max(24, (e.el.textContent?.length ?? 0) * LABEL_CH_PX + 26);
    const h = 18;
    let dx = e.dx;
    let dy = 0;
    for (let k = 0; k < 9; k++) {
      const step = Math.ceil(k / 2) * (h + 3);
      dy = k === 0 ? 0 : k % 2 === 1 ? step : -step;
      dx = e.dx;

      // Keep the whole label inside the canvas; at the right edge a left-
      // anchored label is moved to the left of its point rather than clipped.
      if (e.align === 'left') {
        if (p.x + dx + w > width - 6) dx = width - 6 - w - p.x;
        if (p.x + dx < 6) dx = 6 - p.x;
      } else {
        if (p.x + dx - w < 6) dx = 6 + w - p.x;
        if (p.x + dx > width - 6) dx = width - 6 - p.x;
      }
      const y = Math.max(h / 2 + 6, Math.min(height - h / 2 - 6, p.y + dy));
      dy = y - p.y;
      const x = p.x + dx;
      const box = {
        x0: e.align === 'right' ? x - w : x,
        x1: e.align === 'right' ? x : x + w,
        y0: y - h / 2,
        y1: y + h / 2,
      };
      if (!boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
        boxes.push(box);
        break;
      }
    }
    const cur = e.marker.getOffset();
    if (cur.x !== dx || cur.y !== dy) e.marker.setOffset([dx, dy]);
  }
}

function mercatorY(latDeg: number): number {
  const s = Math.sin(Math.max(-85.05, Math.min(85.05, latDeg)) * DEG);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function invMercatorY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/**
 * Frame the route inside the usable part of the canvas. The camera is shifted
 * so the route centre sits in the padded box rather than the canvas centre,
 * which keeps it clear of the HUD and map controls.
 */
export function fitRouteCamera(
  wps: Waypoint[],
  widthPx: number,
  heightPx: number,
  pad: FitPadding,
): { center: [number, number]; zoom: number } {
  let minLon = wps[0]?.lon ?? 79;
  let maxLon = minLon;
  let minLat = wps[0]?.lat ?? 22;
  let maxLat = minLat;
  for (const w of wps) {
    minLon = Math.min(minLon, w.lon);
    maxLon = Math.max(maxLon, w.lon);
    minLat = Math.min(minLat, w.lat);
    maxLat = Math.max(maxLat, w.lat);
  }
  const availW = Math.max(40, widthPx - pad.left - pad.right);
  const availH = Math.max(40, heightPx - pad.top - pad.bottom);
  const spanX = (Math.max(1e-6, maxLon - minLon) / 360) * WORLD_PX;
  const spanY = Math.max(1e-6, mercatorY(minLat) - mercatorY(maxLat)) * WORLD_PX;
  const zoom = Math.max(
    2,
    Math.min(Math.log2(availW / spanX), Math.log2(availH / spanY), FIT_MAX_ZOOM),
  );
  const world = WORLD_PX * Math.pow(2, zoom);
  const targetX = pad.left + availW / 2;
  const targetY = pad.top + availH / 2;
  const centerLon = (minLon + maxLon) / 2 - ((targetX - widthPx / 2) * 360) / world;
  const centerY = mercatorY((minLat + maxLat) / 2) - (targetY - heightPx / 2) / world;
  return { center: [centerLon, invMercatorY(centerY)], zoom };
}

function routeFc(wps: Waypoint[]): FeatureCollection<LineString> {
  if (wps.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: wps.map((w) => [w.lon, w.lat]),
        },
      },
    ],
  };
}

function flownFc(
  wps: Waypoint[],
  weather: WeatherCell[],
  clockS: number | null,
): FeatureCollection<LineString> {
  if (clockS === null || clockS <= 0 || wps.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const plan = currentPlan(wps, weather);
  const end = Math.min(clockS, plan.totalS);
  if (end <= 0) return { type: 'FeatureCollection', features: [] };
  const n = Math.min(600, Math.max(2, Math.ceil(end / 10)));
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = positionAtClock(plan, wps, (end * i) / n);
    if (p) coordinates.push([p.lon, p.lat]);
  }
  if (coordinates.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    ],
  };
}

function zonesFc(mission: Mission): FeatureCollection<Polygon> {  return {
    type: 'FeatureCollection',
    features: mission.zones.map((z) => ({
      type: 'Feature',
      properties: { type: z.type, name: z.name },
      geometry: { type: 'Polygon', coordinates: [z.polygon] },
    })),
  };
}

function draftFc(draft: [number, number][]): FeatureCollection<LineString> {
  if (draft.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: draft },
      },
    ],
  };
}

function ringFc(mission: Mission): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [circleRing(mission.groundStation.lat, mission.groundStation.lon, MAX_LINK_RANGE_KM * 1000)],
        },
      },
    ],
  };
}

function addLabel(
  map: MaplibreMap,
  entries: LabelEntry[],
  lat: number,
  lon: number,
  text: string,
  className: string,
  dx = 7,
  align: 'left' | 'right' = 'left',
): void {
  const el = document.createElement('div');
  el.className = `${styles.label} ${className}`;
  el.textContent = text;
  const marker = new maplibregl.Marker({ element: el, anchor: align, offset: [dx, 0] })
    .setLngLat([lon, lat])
    .addTo(map);
  entries.push({ marker, el, lat, lon, dx, align });
}

export default function RehearsalMap({
  mission,
  waypoints,
  weather,
  clockS = null,
  showMarker = false,
  editor = false,
  fitPadding = { top: 48, right: 48, bottom: 48, left: 48 },
  height = '100%',
}: RehearsalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const readyRef = useRef(false);
  const labelRef = useRef<LabelEntry[]>([]);
  const lastFitSeq = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const dataRef = useRef({ mission, waypoints, weather, clockS, showMarker, editor });
  dataRef.current = { mission, waypoints, weather, clockS, showMarker, editor };

  const [mapReady, setMapReady] = useState(false);
  const selectedNodeId = useMissionStore((s) => s.selectedNodeId);
  const selectedZoneId = useMissionStore((s) => s.selectedZoneId);
  const selectedSiteId = useMissionStore((s) => s.selectedSiteId);
  const mode = useMissionStore((s) => s.mode);
  const draftZone = useMissionStore((s) => s.draftZone);
  const flyTarget = useMissionStore((s) => s.flyTarget);
  const fitSeq = useMissionStore((s) => s.fitSeq);

  const pushAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const d = dataRef.current;
    (map.getSource(SRC.route) as GeoJSONSource | undefined)?.setData(routeFc(d.waypoints));
    (map.getSource(SRC.zones) as GeoJSONSource | undefined)?.setData(zonesFc(d.mission));
    (map.getSource(SRC.ring) as GeoJSONSource | undefined)?.setData(ringFc(d.mission));
    (map.getSource(SRC.flown) as GeoJSONSource | undefined)?.setData(
      flownFc(d.waypoints, d.weather, d.clockS),
    );

    let cp: { lat: number; lon: number } | null = null;
    if (d.showMarker && d.clockS !== null && d.waypoints.length > 1) {
      const total = currentPlan(d.waypoints, d.weather).totalS;
      if (total > 0) {
        const clock = Math.max(0, Math.min(d.clockS, total - 1e-3));
        cp = missionClockPosition(d.waypoints, d.weather, clock);
      }
    }
    const aircraft: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: cp
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
            },
          ]
        : [],
    };
    (map.getSource(SRC.aircraft) as GeoJSONSource | undefined)?.setData(aircraft);
  }, []);

  // Map is created once; data and labels flow through refs and effects.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE_URL,
      attributionControl: false,
      maxPitch: 60,
      pitchWithRotate: true,
      dragRotate: true,
      touchPitch: true,
      maxZoom: 12,
      minZoom: 3,
      center: [79, 22],
      zoom: 4.2,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© CARTO · © OpenStreetMap contributors · Terrain © Mapzen / AWS',
      }),
      'bottom-right',
    );
    // MapLibre opens compact attribution expanded on creation; start it closed.
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.setAttribute('aria-expanded', 'false');

    let fallback = false;

    const ensureOverlays = () => {
      if (!map.isStyleLoaded()) return;
      hideBaseChrome(map);
      addHillshade(map);
      addDeniedPattern(map);
      addChevronIcon(map);
      addAirportIcon(map);
      for (const id of Object.values(SRC)) {
        if (id !== SRC.dem && !map.getSource(id)) {
          map.addSource(id, {
            type: 'geojson',
            data: id === SRC.airports ? AIRPORTS_FC : EMPTY,
          });
        }
      }
      for (const layer of OVERLAY_LAYERS) {
        if (!map.getLayer(layer.id)) map.addLayer(layer);
      }
      if (!readyRef.current) {
        readyRef.current = true;
        setMapReady(true);
      }
      pushAll();
    };

    const goFallback = () => {
      if (fallback) return;
      fallback = true;
      readyRef.current = false;
      // Controls survive setStyle, so the attribution added at creation stays.
      map.setStyle(FALLBACK_STYLE);
    };

    const onLoad = () => ensureOverlays();
    const onStyleData = () => {
      if (map.isStyleLoaded()) ensureOverlays();
    };
    const onMove = () => layoutLabels(map, labelRef.current, dataRef.current.waypoints);

    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      const store = useMissionStore.getState();
      if (!dataRef.current.editor) {
        store.selectNode(null);
        return;
      }
      if (store.mode === 'draw-zone') {
        // Hold the vertex briefly so the second click of a double-click can
        // finish the polygon instead of adding a duplicate point.
        if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
        clickTimer.current = window.setTimeout(() => {
          clickTimer.current = null;
          useMissionStore.getState().addZoneVertex(e.lngLat.lat, e.lngLat.lng);
        }, CLICK_TO_VERTEX_MS);
        return;
      }
      if (store.mode === 'add-site') {
        store.addSiteAt(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      store.addNodeAt(e.lngLat.lat, e.lngLat.lng);
    };

    const onDoubleClick = () => {
      if (!dataRef.current.editor) return;
      const store = useMissionStore.getState();
      if (store.mode !== 'draw-zone') return;
      if (clickTimer.current !== null) {
        window.clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      store.finishZone();
    };

    map.on('load', onLoad);
    map.on('styledata', onStyleData);
    map.on('move', onMove);
    map.on('click', onMapClick);
    map.on('dblclick', onDoubleClick);
    // Tile and glyph errors are common and do not make the style unusable.
    // The timeout is the fallback path: it only fires when overlays never
    // became ready, which is what an offline style request looks like.
    const timer = window.setTimeout(() => {
      if (!readyRef.current) goFallback();
    }, BASEMAP_TIMEOUT_MS);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    return () => {
      window.clearTimeout(timer);
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
      ro.disconnect();
      map.off('load', onLoad);
      map.off('styledata', onStyleData);
      map.off('move', onMove);
      map.off('click', onMapClick);
      map.off('dblclick', onDoubleClick);
      for (const e of labelRef.current) e.marker.remove();
      labelRef.current = [];
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [pushAll]);

  // Fit-to-route on first paint and whenever a whole mission is loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const first = lastFitSeq.current === null;
    if (!first && lastFitSeq.current === fitSeq) return;
    lastFitSeq.current = fitSeq;
    const el = map.getContainer();
    if (el.clientWidth < 10 || el.clientHeight < 10) return;
    const target = fitRouteCamera(waypoints, el.clientWidth, el.clientHeight, fitPadding);
    if (first) map.jumpTo(target);
    else map.flyTo({ ...target, duration: 900 });
  }, [mapReady, fitSeq, waypoints, fitPadding]);

  // Search result: fly the camera to the chosen place without touching the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyTarget) return;
    map.flyTo({ center: [flyTarget.lon, flyTarget.lat], zoom: 10.5, duration: 900 });
  }, [mapReady, flyTarget]);

  // Route, zones, link ring and aircraft data.
  useEffect(() => {
    pushAll();
  }, [pushAll, mission, waypoints, weather, clockS, showMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(SRC.draft) as GeoJSONSource | undefined)?.setData(draftFc(draftZone));
  }, [draftZone, mapReady]);

  // Home, destination, zones, sites and the ground station.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const entries: LabelEntry[] = [];
    const first = mission.nodes[0];
    const last = mission.nodes[mission.nodes.length - 1];
    if (first && last) {
      const sameEndpoint = distanceM(first.lat, first.lon, last.lat, last.lon) < 500;
      if (sameEndpoint) {
        addLabel(map, entries, first.lat, first.lon, 'Home', styles.home);
      } else {
        addLabel(map, entries, first.lat, first.lon, 'Home', styles.home);
        addLabel(map, entries, last.lat, last.lon, 'Destination', styles.dest);
      }
    }
    addLabel(
      map,
      entries,
      mission.groundStation.lat,
      mission.groundStation.lon,
      'Ground station',
      styles.ground,
    );
    for (const zone of mission.zones) {
      const ring = zone.polygon.slice(0, -1);
      if (!ring.length) continue;
      const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      addLabel(
        map,
        entries,
        lat,
        lon,
        zone.name,
        zone.type === 'DENIED' ? styles.denied : styles.restricted,
        -4,
        'right',
      );
    }
    for (const site of mission.customSites) {
      addLabel(map, entries, site.lat, site.lon, site.name, styles.site);
    }

    labelRef.current = entries;
    requestAnimationFrame(() => layoutLabels(map, entries, waypoints));
    return () => {
      for (const e of entries) e.marker.remove();
      if (labelRef.current === entries) labelRef.current = [];
    };
  }, [mapReady, mission, waypoints]);

  // Route nodes. Editor mode adds dragging, selection and a hover altitude tag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers: MaplibreMarker[] = [];
    const store = useMissionStore.getState();
    for (let i = 0; i < mission.nodes.length; i++) {
      const node = mission.nodes[i];
      const wp = waypoints[i];
      const el = document.createElement('div');
      const selected = editor && node.id === selectedNodeId;
      el.className = `${styles.wp} ${styles[node.type.toLowerCase()] ?? ''}${selected ? ` ${styles.sel}` : ''}`;
      el.title = `${node.name} · ${node.type.toLowerCase()} · ${Math.round(wp?.altM ?? node.alt)} m AMSL`;
      const num = document.createElement('span');
      num.className = styles.wpNum;
      num.textContent = String(i + 1);
      const alt = document.createElement('span');
      alt.className = styles.wpAlt;
      alt.textContent = `${node.name} - ${Math.round(wp?.altM ?? node.alt)} m AMSL`;
      el.append(num, alt);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (editor) useMissionStore.getState().selectNode(node.id);
      });
      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        draggable: editor,
      })
        .setLngLat([node.lon, node.lat])
        .addTo(map);
      if (editor) {
        marker.on('dragstart', () => {
          store.selectNode(node.id);
        });
        marker.on('dragend', () => {
          const p = marker.getLngLat();
          useMissionStore.getState().moveNode(node.id, p.lat, p.lng);
        });
      }
      markers.push(marker);
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [mapReady, mission.nodes, waypoints, editor, selectedNodeId]);

  // Insert handles sit at each leg midpoint while editing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !editor) return;
    const markers: MaplibreMarker[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const mid = legMidpoint(waypoints[i], waypoints[i + 1]);
      const el = document.createElement('div');
      el.className = styles.insert;
      el.title = `Insert a node between ${waypoints[i].name} and ${waypoints[i + 1].name}`;
      el.textContent = '+';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        useMissionStore.getState().insertNodeAfter(i, mid.lat, mid.lon);
      });
      markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([mid.lon, mid.lat]).addTo(map));
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [mapReady, waypoints, editor]);

  // Selected zone vertices, plus a marker for every draft vertex.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !editor) return;
    const markers: MaplibreMarker[] = [];
    const selected = mission.zones.find((z) => z.id === selectedZoneId);
    if (selected) {
      for (let i = 0; i < selected.polygon.length - 1; i++) {
        const [lon, lat] = selected.polygon[i];
        const el = document.createElement('div');
        el.className = styles.vertex;
        el.title = 'Drag to move this zone vertex';
        const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: true })
          .setLngLat([lon, lat])
          .addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLngLat();
          useMissionStore.getState().moveZoneVertex(selected.id, i, p.lat, p.lng);
        });
        markers.push(marker);
      }
    }
    for (let i = 0; i < draftZone.length; i++) {
      const [lon, lat] = draftZone[i];
      const el = document.createElement('div');
      el.className = styles.vertex;
      el.title = `Vertex ${i + 1}`;
      markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(map));
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [mapReady, editor, mission.zones, selectedZoneId, draftZone]);

  // Ground station marker and custom site markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers: MaplibreMarker[] = [];
    if (editor || showMarker) {
      const el = document.createElement('div');
      el.className = styles.groundMarker;
      el.title = 'Ground station - drag to move';
      const gs = new maplibregl.Marker({ element: el, anchor: 'center', draggable: editor })
        .setLngLat([mission.groundStation.lon, mission.groundStation.lat])
        .addTo(map);
      if (editor) {
        gs.on('dragend', () => {
          const p = gs.getLngLat();
          useMissionStore.getState().setGround(p.lat, p.lng);
        });
      }
      markers.push(gs);
    }
    for (const site of mission.customSites) {
      const el = document.createElement('div');
      el.className = `${styles.siteMarker}${editor && site.id === selectedSiteId ? ` ${styles.sel}` : ''}`;
      el.title = `${site.name} - ${site.type} - ${site.elevM} m${editor ? ' - drag to move' : ''}`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (editor) useMissionStore.getState().selectSite(site.id);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: editor })
        .setLngLat([site.lon, site.lat])
        .addTo(map);
      if (editor) {
        marker.on('dragend', () => {
          const p = marker.getLngLat();
          useMissionStore.getState().updateSite(site.id, { lat: p.lat, lon: p.lng });
        });
      }
      markers.push(marker);
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [mapReady, editor, mission.groundStation, mission.customSites, selectedSiteId, showMarker]);

  return (
    <div
      className={`${styles.frame}${editor ? ` ${styles.editor}` : ''}`}
      style={{ height }}
    >
      <div
        ref={containerRef}
        className={`${styles.wrap}${mode === 'draw-zone' ? ` ${styles.crosshair}` : ''}`}
        aria-label="Mission route map"
      />
      <span className={`${styles.tick} ${styles.tickTL}`} aria-hidden="true" />
      <span className={`${styles.tick} ${styles.tickTR}`} aria-hidden="true" />
      <span className={`${styles.tick} ${styles.tickBL}`} aria-hidden="true" />
      <span className={`${styles.tick} ${styles.tickBR}`} aria-hidden="true" />
    </div>
  );
}
