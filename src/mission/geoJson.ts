// Mission interchange. The FeatureCollection carries a LineString for the
// route, one Point per node (with its mission properties), Polygons for zones,
// a Point for the ground station and Points for custom landing sites. A foreign
// `mission` member holds the complete object so an export round-trips exactly;
// imports without it are reconstructed from the features.
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson';
import type {
  AltRef,
  LandingSite,
  Mission,
  MissionNode,
  MissionZone,
  NodeType,
  SiteType,
  ZoneType,
} from './types';
import { ALT_REFS, NODE_TYPES, SITE_TYPES, ZONE_TYPES, clampFuelLoadKg } from './types';

export interface MissionFeatureCollection extends FeatureCollection {
  /** Complete mission, so a round-trip preserves ids and all metadata. */
  mission?: Mission;
}

function nodeFeature(n: MissionNode): Feature<Point> {
  return {
    type: 'Feature',
    properties: {
      kind: 'node',
      id: n.id,
      type: n.type,
      name: n.name,
      alt: n.alt,
      altRef: n.altRef,
      loiterMin: n.loiterMin,
      ...(n.speed !== undefined ? { speed: n.speed } : {}),
    },
    geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
  };
}

function zoneFeature(z: MissionZone): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { kind: 'zone', id: z.id, name: z.name, zoneType: z.type },
    geometry: { type: 'Polygon', coordinates: [z.polygon] },
  };
}

function siteFeature(s: LandingSite): Feature<Point> {
  return {
    type: 'Feature',
    properties: {
      kind: 'site',
      id: s.id,
      name: s.name,
      siteType: s.type,
      elevM: s.elevM,
    },
    geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
  };
}

export function missionToGeoJson(m: Mission): MissionFeatureCollection {
  const route: Feature<LineString> = {
    type: 'Feature',
    properties: {
      kind: 'route',
      name: m.name,
      engineProfileId: m.engineProfileId,
      startTimeUTC: m.startTimeUTC,
    },
    geometry: { type: 'LineString', coordinates: m.nodes.map((n) => [n.lon, n.lat]) },
  };
  return {
    type: 'FeatureCollection',
    features: [
      route,
      ...m.nodes.map(nodeFeature),
      ...m.zones.map(zoneFeature),
      {
        type: 'Feature',
        properties: { kind: 'groundStation' },
        geometry: { type: 'Point', coordinates: [m.groundStation.lon, m.groundStation.lat] },
      },
      ...m.customSites.map(siteFeature),
    ],
    mission: m,
  };
}

export function missionToGeoJsonText(m: Mission): string {
  return JSON.stringify(missionToGeoJson(m), null, 2);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validNode(n: unknown): n is MissionNode {
  if (!n || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  return (
    isFiniteNum(o.id) &&
    typeof o.type === 'string' &&
    NODE_TYPES.includes(o.type as NodeType) &&
    typeof o.name === 'string' &&
    isFiniteNum(o.lat) &&
    isFiniteNum(o.lon) &&
    isFiniteNum(o.alt) &&
    (o.altRef === 'AGL' || o.altRef === 'AMSL') &&
    isFiniteNum(o.loiterMin)
  );
}

/** Accepts our own export (fast path) and a best-effort foreign FeatureCollection. */
export function missionFromGeoJson(text: string): { mission: Mission | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { mission: null, error: 'File is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { mission: null, error: 'GeoJSON root must be an object.' };
  const fc = raw as MissionFeatureCollection & { features?: unknown };
  if (fc.mission && typeof fc.mission === 'object') {
    const m = fc.mission as Mission;
    if (
      Array.isArray(m.nodes) &&
      m.nodes.length >= 2 &&
      m.nodes.every(validNode) &&
      Array.isArray(m.zones) &&
      Array.isArray(m.customSites) &&
      m.groundStation
    ) {
      return { mission: normalizeMission(m), error: null };
    }
    return { mission: null, error: 'GeoJSON mission member is incomplete.' };
  }
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { mission: null, error: 'Expected a GeoJSON FeatureCollection.' };
  }
  const features = fc.features as Feature<Geometry>[];
  const line = features.find(
    (f): f is Feature<LineString> => f.geometry?.type === 'LineString',
  );
  if (!line || line.geometry.coordinates.length < 2) {
    return { mission: null, error: 'GeoJSON has no route LineString with at least two points.' };
  }
  const points = features.filter(
    (f): f is Feature<Point> =>
      f.geometry?.type === 'Point' && (f.properties as Record<string, unknown> | null)?.kind !== 'groundStation',
  );
  const nodePoints = points.filter(
    (f) => (f.properties as Record<string, unknown> | null)?.kind === 'node',
  );
  const routeNodes = line.geometry.coordinates.map(([lon, lat], i) => {
    const p = nodePoints[i]?.properties as Record<string, unknown> | undefined;
    const alt = isFiniteNum(p?.alt) ? p.alt : 1000;
    const altRef: AltRef = p?.altRef === 'AGL' ? 'AGL' : 'AMSL';
    const rawType = p?.type;
    const type: NodeType = NODE_TYPES.includes(rawType as NodeType)
      ? (rawType as NodeType)
      : i === 0
        ? 'LAUNCH'
        : i === line.geometry.coordinates.length - 1
          ? 'LAND'
          : 'WAYPOINT';
    return {
      id: isFiniteNum(p?.id) ? p.id : i + 1,
      type,
      name: typeof p?.name === 'string' && p.name ? p.name : `WP${i + 1}`,
      lat,
      lon,
      alt,
      altRef,
      loiterMin: isFiniteNum(p?.loiterMin) ? Math.max(0, p.loiterMin) : 0,
      ...(isFiniteNum(p?.speed) ? { speed: p.speed } : {}),
    } satisfies MissionNode;
  });
  const zones: MissionZone[] = features
    .filter((f): f is Feature<Polygon> => f.geometry?.type === 'Polygon')
    .map((f, i) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const ring = f.geometry.coordinates[0] ?? [];
      return {
        id: isFiniteNum(p.id) ? p.id : 100 + i,
        name: typeof p.name === 'string' ? p.name : `ZONE ${i + 1}`,
        type: ZONE_TYPES.includes(p.zoneType as ZoneType) ? (p.zoneType as ZoneType) : 'DENIED',
        polygon: ring.map(([lon, lat]) => [lon, lat] as [number, number]),
      } satisfies MissionZone;
    })
    .filter((z) => z.polygon.length >= 3);
  const groundFeature = features.find(
    (f): f is Feature<Point> =>
      f.geometry?.type === 'Point' &&
      (f.properties as Record<string, unknown> | null)?.kind === 'groundStation',
  );
  const firstPt = line.geometry.coordinates[0];
  const groundStation = groundFeature
    ? { lat: groundFeature.geometry.coordinates[1], lon: groundFeature.geometry.coordinates[0] }
    : { lat: firstPt[1], lon: firstPt[0] };
  const customSites: LandingSite[] = features
    .filter(
      (f): f is Feature<Point> =>
        f.geometry?.type === 'Point' &&
        (f.properties as Record<string, unknown> | null)?.kind === 'site',
    )
    .map((f, i) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const rawName = typeof p.name === 'string' ? p.name.trim() : '';
      return {
        id: isFiniteNum(p.id) ? p.id : 200 + i,
        name: rawName || `Site ${i + 1}`,
        type: SITE_TYPES.includes(p.siteType as SiteType) ? (p.siteType as SiteType) : 'STRIP',
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        elevM: isFiniteNum(p.elevM) ? p.elevM : 0,
      } satisfies LandingSite;
    });
  const routeProps = (line.properties ?? {}) as Record<string, unknown>;
  const engineProfileId =
    typeof routeProps.engineProfileId === 'string' ? routeProps.engineProfileId : 'nominal';
  const mission: Mission = {
    id: `import-${Date.now().toString(36)}`,
    name: typeof routeProps.name === 'string' && routeProps.name ? routeProps.name : 'IMPORTED MISSION',
    engineProfileId,
    startTimeUTC:
      typeof routeProps.startTimeUTC === 'string'
        ? routeProps.startTimeUTC
        : new Date().toISOString(),
    nodes: routeNodes,
    zones,
    groundStation,
    customSites,
    fuelLoadKg: clampFuelLoadKg(routeProps.fuelLoadKg, engineProfileId),
    weatherMode: 'forecast',
    illustrative: true,
  };
  return { mission: normalizeMission(mission), error: null };
}

function normalizeMission(m: Mission): Mission {
  return {
    ...m,
    fuelLoadKg: clampFuelLoadKg(m.fuelLoadKg, m.engineProfileId),
    nodes: m.nodes.map((n) => ({
      ...n,
      id: Math.round(n.id),
      lat: Math.max(-89.9, Math.min(89.9, n.lat)),
      lon: Math.max(-180, Math.min(180, n.lon)),
      alt: Math.max(0, Math.round(n.alt)),
      altRef: ALT_REFS.includes(n.altRef) ? n.altRef : 'AMSL',
      loiterMin: Math.max(0, Math.round(n.loiterMin)),
      ...(n.speed !== undefined && isFiniteNum(n.speed) ? { speed: Math.max(5, n.speed) } : {}),
    })),
    zones: m.zones.map((z) => ({
      ...z,
      type: ZONE_TYPES.includes(z.type) ? z.type : 'DENIED',
      polygon: z.polygon.map(([lon, lat]) => [lon, lat] as [number, number]),
    })),
    customSites: m.customSites.map((s) => ({
      ...s,
      type: SITE_TYPES.includes(s.type) ? s.type : 'STRIP',
    })),
    groundStation: { lat: m.groundStation.lat, lon: m.groundStation.lon },
  };
}
