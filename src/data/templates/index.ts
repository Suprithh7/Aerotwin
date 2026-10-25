// Editable mission templates. The three original exercise routes now live here
// in the same schema as a hand-drawn mission, alongside two civil survey
// examples. All geography is illustrative (see ASSUMPTIONS.md).
import ladakh from './ladakh.json';
import rajasthan from './rajasthan.json';
import coastal from './coastal.json';
import plainsAgri from './plains-agri.json';
import coastalSurvey from './coastal-survey.json';
import type { Mission, MissionTemplate } from '../../mission/types';

export const MISSION_TEMPLATES = [
  ladakh,
  rajasthan,
  coastal,
  plainsAgri,
  coastalSurvey,
] as unknown as MissionTemplate[];

const BY_ID = new Map(MISSION_TEMPLATES.map((t) => [t.id, t]));

export function templateById(id: string): MissionTemplate | undefined {
  return BY_ID.get(id);
}

export function cloneTemplate(id: string): Mission {
  const t = templateById(id) ?? MISSION_TEMPLATES[0];
  return {
    ...t,
    nodes: t.nodes.map((n) => ({ ...n })),
    zones: t.zones.map((z) => ({ ...z, polygon: z.polygon.map((p) => [...p] as [number, number]) })),
    customSites: t.customSites.map((s) => ({ ...s })),
    groundStation: { ...t.groundStation },
  };
}
