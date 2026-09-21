import {Scene} from '../../../src/core/Scene';
import {DirectionalLight} from '../../../src/lighting/DirectionalLight';
import {OmniLight} from '../../../src/lighting/OmniLight';

export interface PreviewDirectionalLightFixture {
  readonly id: string;
  readonly enabled: boolean;
  readonly angle: number;
  readonly elevation: number;
  readonly color: string;
  readonly intensity: number;
}

export interface PreviewOmniLightFixture {
  readonly id: string;
  readonly enabled: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly color: string;
  readonly intensity: number;
  readonly falloff: 'linear' | 'quadratic';
  readonly isGlobal: boolean;
}

export interface PreviewLightingFixture {
  readonly id: string;
  readonly label: string;
  readonly view: {
    readonly rotation: number;
    readonly elevation: number;
    readonly zoom: number;
  };
  readonly ambient: {
    readonly color: string;
    readonly intensity: number;
  };
  readonly directionalLights: readonly PreviewDirectionalLightFixture[];
  readonly omniLights: readonly PreviewOmniLightFixture[];
}

interface FixtureOverrides {
  rotation?: number;
  elevation?: number;
  zoom?: number;
  ambientColor?: string;
  ambientIntensity?: number;
  sun?: Partial<Omit<PreviewDirectionalLightFixture, 'id'>>;
  workLight?: Partial<Omit<PreviewOmniLightFixture, 'id'>>;
  lanterns?: Partial<Omit<PreviewOmniLightFixture, 'id' | 'x' | 'y' | 'z' | 'color'>>;
  skyFill?: Partial<Omit<PreviewOmniLightFixture, 'id'>>;
}

const DEFAULT_PREVIEW_LIGHTING_FIXTURE_ID = 'day-ne';

export const PREVIEW_LIGHTING_FIXTURES: readonly PreviewLightingFixture[] = [
  fixture('day-ne', '日景 · 东北 (0°)'),
  fixture('day-nw', '日景 · 西北 (90°)', {rotation: 90}),
  fixture('day-sw', '日景 · 西南 (180°)', {rotation: 180}),
  fixture('day-se', '日景 · 东南 (270°)', {rotation: 270}),
  fixture('low-angle', '低俯角 · 长阴影', {
    elevation: 0.32,
    sun: {elevation: 18, intensity: 0.64},
  }),
  fixture('top-down', '高俯角 · 顶视', {
    elevation: 0.82,
    sun: {elevation: 78, intensity: 0.48},
  }),
  fixture('night-lanterns', '夜景 · 灯笼', {
    ambientColor: '#718099',
    ambientIntensity: 0.11,
    sun: {elevation: 20, color: '#6f85bd', intensity: 0.08},
    workLight: {color: '#809fff', intensity: 0.2},
    lanterns: {intensity: 1.08},
    skyFill: {color: '#4d6580', intensity: 0.06},
  }),
  fixture('global-only', '仅全局光', {
    ambientColor: '#d8e1e7',
    ambientIntensity: 0.15,
    sun: {enabled: false},
    workLight: {enabled: false},
    lanterns: {enabled: false},
    skyFill: {color: '#b7d9ff', intensity: 0.62},
  }),
  fixture('lights-off', '禁用全部灯光', {
    ambientIntensity: 0.35,
    sun: {enabled: false},
    workLight: {enabled: false},
    lanterns: {enabled: false},
    skyFill: {enabled: false},
  }),
];

const FIXTURES_BY_ID = new Map(PREVIEW_LIGHTING_FIXTURES.map(entry => [entry.id, entry]));

export {DEFAULT_PREVIEW_LIGHTING_FIXTURE_ID};

export function getPreviewLightingFixture(id: string | null | undefined): PreviewLightingFixture | undefined {
  return id ? FIXTURES_BY_ID.get(id) : undefined;
}

export function applyPreviewLightingFixture(
  scene: Scene,
  fixtureOrId: PreviewLightingFixture | string
): PreviewLightingFixture {
  const selected = typeof fixtureOrId === 'string'
    ? getPreviewLightingFixture(fixtureOrId)
    : fixtureOrId;
  if (!selected) {throw new Error(`Unknown WebGL preview fixture: ${fixtureOrId}.`);}

  scene.view = {
    rotation: selected.view.rotation,
    elevation: selected.view.elevation,
  };
  scene.camera.setZoom(selected.view.zoom);
  scene.ambientColor = selected.ambient.color;
  scene.ambientIntensity = selected.ambient.intensity;

  for (const state of selected.directionalLights) {
    const light = requireLight(scene, state.id, DirectionalLight);
    light.enabled = state.enabled;
    light.angle = degreesToRadians(state.angle);
    light.elevation = degreesToRadians(state.elevation);
    light.color = state.color;
    light.intensity = state.intensity;
  }

  for (const state of selected.omniLights) {
    const light = requireLight(scene, state.id, OmniLight);
    light.enabled = state.enabled;
    light.position.x = state.x;
    light.position.y = state.y;
    light.position.z = state.z;
    light.radius = state.radius;
    light.color = state.color;
    light.intensity = state.intensity;
    light.falloff = state.falloff;
    light.isGlobal = state.isGlobal;
  }

  return selected;
}

function fixture(id: string, label: string, overrides: FixtureOverrides = {}): PreviewLightingFixture {
  const sun: PreviewDirectionalLightFixture = {
    id: 'sun',
    enabled: true,
    angle: 220,
    elevation: 48,
    color: '#f0f6e8',
    intensity: 0.5,
    ...overrides.sun,
  };
  const workLight: PreviewOmniLightFixture = {
    id: 'work-light',
    enabled: true,
    x: 6,
    y: 5,
    z: 96,
    radius: 300,
    color: '#b7d8ff',
    intensity: 0.8,
    falloff: 'quadratic',
    isGlobal: false,
    ...overrides.workLight,
  };
  const lanternDefaults = {
    enabled: true,
    radius: 170,
    intensity: 0.78,
    falloff: 'quadratic' as const,
    isGlobal: false,
    ...overrides.lanterns,
  };
  const skyFill: PreviewOmniLightFixture = {
    id: 'sky-fill',
    enabled: true,
    x: 0,
    y: 0,
    z: 0,
    radius: 320,
    color: '#7fa8a0',
    intensity: 0.17,
    falloff: 'linear',
    isGlobal: true,
    ...overrides.skyFill,
  };

  return {
    id,
    label,
    view: {
      rotation: overrides.rotation ?? 0,
      elevation: overrides.elevation ?? 0.5,
      zoom: overrides.zoom ?? 1,
    },
    ambient: {
      color: overrides.ambientColor ?? '#dcebe4',
      intensity: overrides.ambientIntensity ?? 0.44,
    },
    directionalLights: [sun],
    omniLights: [
      workLight,
      {
        id: 'lantern-west-light',
        x: 4.75,
        y: 3.25,
        z: 52,
        color: '#ffd166',
        ...lanternDefaults,
      },
      {
        id: 'lantern-east-light',
        x: 7.5,
        y: 3.25,
        z: 52,
        color: '#ffcf73',
        ...lanternDefaults,
      },
      skyFill,
    ],
  };
}

function requireLight<T extends DirectionalLight | OmniLight>(
  scene: Scene,
  id: string,
  ctor: new (...args: never[]) => T
): T {
  const light = scene.getLightById(id);
  if (!(light instanceof ctor)) {
    throw new Error(`WebGL preview fixture requires ${ctor.name} #${id}.`);
  }
  return light;
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}
