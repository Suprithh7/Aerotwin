import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { currentPlan, missionClockPosition } from '../../mission/missionStore';
import { distanceM, presetById, type Waypoint } from '../../mission/route';
import type { WeatherCell } from '../../mission/weather';
import { AIRFIELDS } from '../../data/airfields';
import {
  DENIED_LABEL,
  groundForPreset,
  zoneForPreset,
  zoneLabelPoint,
} from '../../data/zones';
import styles from './RehearsalMap.module.css';

const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'aerotwin-fallback-bg', type: 'background', paint: { 'background-color': '#0B0D10' } }],
};

const BASEMAP_TIMEOUT_MS = 6000;
const FIT_MAX_ZOOM = 10;
const WORLD_PX = 512;
const DEG = Math.PI / 180;

const STEEL = '#5B8DB8';
const RED = '#C4443F';
const TXT = '#D7DEE7';
const DIM = '#93A0B0';
const DATA = '#5E9C9A';
const BG0 = '#0B0D10';

const SRC = {
  route: 'aerotwin-route',
  denied: 'aerotwin-denied',
  aircraft: 'aerotwin-aircraft',
  dem: 'aerotwin-dem',
} as const;

const LAYER = {
  deniedFill: 'aerotwin-denied-fill',
  deniedLine: 'aerotwin-denied-line',
  routeCasing: 'aerotwin-route-casing',
  routeLine: 'aerotwin-route-line',
  chevrons: 'aerotwin-route-chevrons',
  chevronIcon: 'aerotwin-chevron-icon',
  aircraft: 'aerotwin-aircraft-dot',
  stateLabel: 'aerotwin-state-labels',
  cityLabel: 'aerotwin-city-labels',
  hillshade: 'aerotwin-hillshade',
  hatch: 'aerotwin-denied-hatch',
} as const;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

// Rough subcontinent extent for the label filter. It is not a boundary: it is
// a generous box used only to keep state and city labels off neighbouring
// regions, and it is never drawn.
const INDIA_LABEL_RING: [number, number][] = [
  [68.0, 23.5],
  [70.5, 20.5],
  [72.5, 17.0],
  [74.0, 13.0],
  [77.0, 7.5],
  [80.5, 9.0],
  [84.0, 13.0],
  [86.5, 20.0],
  [89.5, 22.0],
  [92.5, 24.0],
  [97.5, 27.5],
  [97.5, 29.0],
  [94.5, 29.5],
  [91.0, 28.5],
  [88.0, 28.5],
  [85.0, 29.5],
  [82.0, 31.0],
  [80.0, 33.0],
  [78.5, 35.8],
  [74.0, 35.8],
  [75.5, 32.5],
  [73.5, 29.5],
  [71.0, 28.0],
  [69.5, 27.0],
  [68.0, 23.5],
];

const INDIA_WITHIN = [
  'within',
  { type: 'Polygon', coordinates: [INDIA_LABEL_RING] },
] as unknown as FilterSpecification;

const FONT = ['Montserrat SemiBold', 'Open Sans Bold', 'Noto Sans Regular'];

const LABEL_CH_PX = 7.2;

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RehearsalMapProps {
  waypoints: Waypoint[];
  weather: WeatherCell[];
  presetId: string;
  /** Mission clock, s; shows the aircraft marker only when not null. */
  clockS?: number | null;
  showMarker?: boolean;
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
    // Keep only the dark land/water fills and terrain; every base line, label,
    // place dot and road symbol is removed so the map carries our own chrome.
    if (layer.type === 'background' || layer.type === 'fill' || layer.type === 'raster') continue;
    if (map.getLayoutProperty(layer.id, 'visibility') === 'none') continue;
    map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
}

function addHillshade(map: MaplibreMap): void {
  if (!map.getSource('protomaps')) return;
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
  if (map.getLayer(LAYER.hillshade)) return;
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

function addPlaceLabels(map: MaplibreMap): void {
  if (!map.getSource('protomaps')) return;
  // City layer goes in first so the state layer sits above it: a later symbol
  // layer wins label collisions in MapLibre, and states are the coarser
  // reference when both are on screen.
  if (!map.getLayer(LAYER.cityLabel)) {
    map.addLayer({
      id: LAYER.cityLabel,
      type: 'symbol',
      source: 'protomaps',
      'source-layer': 'places',
      minzoom: 5,
      maxzoom: 12,
      filter: [
        'all',
        ['==', ['get', 'kind'], 'locality'],
        ['==', ['get', 'kind_detail'], 'city'],
        ['<=', ['coalesce', ['get', 'min_zoom'], 5], 6],
        INDIA_WITHIN,
      ] as unknown as FilterSpecification,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 9, 14],
        'text-transform': 'uppercase',
        'text-max-width': 10,
        'text-padding': 8,
        'symbol-sort-key': ['coalesce', ['get', 'population_rank'], 0],
      },
      paint: {
        'text-color': TXT,
        'text-halo-color': BG0,
        'text-halo-width': 1.2,
      },
    } as LayerSpecification);
  }
  if (!map.getLayer(LAYER.stateLabel)) {
    map.addLayer({
      id: LAYER.stateLabel,
      type: 'symbol',
      source: 'protomaps',
      'source-layer': 'places',
      minzoom: 5,
      maxzoom: 12,
      filter: ['all', ['==', ['get', 'kind'], 'region'], INDIA_WITHIN] as unknown as FilterSpecification,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 8, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-width': 9,
        'text-padding': 10,
        'symbol-sort-key': ['coalesce', ['get', 'population_rank'], 0],
      },
      paint: {
        'text-color': DIM,
        'text-halo-color': BG0,
        'text-halo-width': 1.2,
      },
    } as LayerSpecification);
  }
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
  ctx.strokeStyle = RED;
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
  ctx.strokeStyle = STEEL;
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

const OVERLAY_LAYERS: LayerSpecification[] = [
  {
    id: LAYER.deniedFill,
    type: 'fill',
    source: SRC.denied,
    paint: { 'fill-pattern': LAYER.hatch, 'fill-opacity': 0.18 },
  },
  {
    id: LAYER.deniedLine,
    type: 'line',
    source: SRC.denied,
    paint: { 'line-color': RED, 'line-width': 1, 'line-opacity': 0.55 },
  },
  {
    id: LAYER.routeCasing,
    type: 'line',
    source: SRC.route,
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: { 'line-color': BG0, 'line-width': 6, 'line-opacity': 0.92 },
  },
  {
    id: LAYER.routeLine,
    type: 'line',
    source: SRC.route,
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: { 'line-color': STEEL, 'line-width': 2, 'line-opacity': 0.95 },
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
    id: LAYER.aircraft,
    type: 'circle',
    source: SRC.aircraft,
    paint: {
      'circle-radius': 4.5,
      'circle-color': DATA,
      'circle-stroke-color': BG0,
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

function deniedFc(presetId: string): FeatureCollection<Polygon> {
  const zone = zoneForPreset(presetId);
  if (!zone) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [zone.polygon] },
      },
    ],
  };
}

export default function RehearsalMap({
  waypoints,
  weather,
  presetId,
  clockS = null,
  showMarker = false,
  fitPadding = { top: 48, right: 48, bottom: 48, left: 48 },
  height = '100%',
}: RehearsalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const readyRef = useRef(false);
  const labelRef = useRef<LabelEntry[]>([]);
  const lastFitPreset = useRef<string | null>(null);
  const dataRef = useRef({ waypoints, weather, presetId, clockS, showMarker });
  dataRef.current = { waypoints, weather, presetId, clockS, showMarker };

  const [mapReady, setMapReady] = useState(false);
  const [selectedWp, setSelectedWp] = useState<number | null>(null);

  const pushAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const d = dataRef.current;
    const routeSrc = map.getSource(SRC.route) as GeoJSONSource | undefined;
    routeSrc?.setData(routeFc(d.waypoints));
    const deniedSrc = map.getSource(SRC.denied) as GeoJSONSource | undefined;
    deniedSrc?.setData(deniedFc(d.presetId));

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
      maxPitch: 0,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
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
      addPlaceLabels(map);
      addDeniedPattern(map);
      addChevronIcon(map);
      for (const id of Object.values(SRC)) {
        if (id !== SRC.dem && !map.getSource(id)) {
          map.addSource(id, { type: 'geojson', data: EMPTY });
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
    const onClick = () => setSelectedWp(null);

    map.on('load', onLoad);
    map.on('styledata', onStyleData);
    map.on('move', onMove);
    map.on('click', onClick);
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
      ro.disconnect();
      map.off('load', onLoad);
      map.off('styledata', onStyleData);
      map.off('move', onMove);
      map.off('click', onClick);
      for (const e of labelRef.current) e.marker.remove();
      labelRef.current = [];
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [pushAll]);

  // Fit-to-route, both on first paint and whenever a preset is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const first = lastFitPreset.current === null;
    if (!first && lastFitPreset.current === presetId) return;
    lastFitPreset.current = presetId;
    const el = map.getContainer();
    if (el.clientWidth < 10 || el.clientHeight < 10) return;
    const target = fitRouteCamera(waypoints, el.clientWidth, el.clientHeight, fitPadding);
    if (first) map.jumpTo(target);
    else map.flyTo({ ...target, duration: 900 });
  }, [mapReady, presetId, waypoints, fitPadding]);

  useEffect(() => setSelectedWp(null), [presetId]);

  // Route and aircraft data. Clock and route updates are pushed without
  // rebuilding sources or layers.
  useEffect(() => {
    pushAll();
  });

  // Home, destination, alternate, ground-station and denied-area labels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const entries: LabelEntry[] = [];
    const add = (
      lat: number,
      lon: number,
      text: string,
      className: string,
      dx = 7,
      align: 'left' | 'right' = 'left',
    ) => {
      const el = document.createElement('div');
      el.className = `${styles.label} ${className}`;
      el.textContent = text;
      const marker = new maplibregl.Marker({ element: el, anchor: align, offset: [dx, 0] })
        .setLngLat([lon, lat])
        .addTo(map);
      entries.push({ marker, el, lat, lon, dx, align });
    };

    const preset = presetById(presetId);
    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    if (preset && first && last) {
      const sameEndpoint = distanceM(first.lat, first.lon, last.lat, last.lon) < 500;
      if (sameEndpoint) {
        add(first.lat, first.lon, 'HOME / DEST', styles.home);
      } else {
        add(first.lat, first.lon, 'HOME', styles.home);
        add(last.lat, last.lon, 'DEST', styles.dest);
      }
      for (const icao of preset.alternateIcaos) {
        const af = AIRFIELDS.find((a) => a.icao === icao);
        if (af) add(af.lat, af.lon, `ALT ${af.icao}`, styles.alt);
      }
    }
    const ground = groundForPreset(presetId);
    if (ground) add(ground.lat, ground.lon, 'GROUND STATION', styles.ground);
    const zone = zoneForPreset(presetId);
    if (zone) {
      const p = zoneLabelPoint(zone);
      add(p.lat, p.lon, DENIED_LABEL, styles.denied, -4, 'right');
    }

    labelRef.current = entries;
    requestAnimationFrame(() => layoutLabels(map, entries, waypoints));
    return () => {
      for (const e of entries) e.marker.remove();
      if (labelRef.current === entries) labelRef.current = [];
    };
  }, [mapReady, presetId, waypoints]);

  // Numbered waypoints; the altitude tag is CSS-only on hover or selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers: MaplibreMarker[] = [];
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const el = document.createElement('div');
      el.className = `${styles.wp}${wp.id === selectedWp ? ` ${styles.sel}` : ''}`;
      el.title = `${wp.name} waypoint`;
      const num = document.createElement('span');
      num.textContent = String(i + 1);
      const alt = document.createElement('span');
      alt.className = styles.wpAlt;
      alt.textContent = `${Math.round(wp.altM)} m AMSL`;
      el.append(num, alt);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSelectedWp((prev) => (prev === wp.id ? null : wp.id));
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([wp.lon, wp.lat])
        .addTo(map);
      markers.push(marker);
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [mapReady, waypoints, selectedWp]);

  return (
    <div
      ref={containerRef}
      className={styles.wrap}
      style={{ height }}
      aria-label="Mission route map"
    />
  );
}
