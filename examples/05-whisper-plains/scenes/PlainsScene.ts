/**
 * PlainsScene — 低语草原
 *
 * 16×16 场景，带完整碰撞地图：
 * - 边界不可走，树木位置不可走
 * - 传送阵附近保持开阔
 * - 三种光源：太阳方向光 + 暖色环境光 + 传送阵紫光
 */
import {Scene} from '../../../src/core/Scene';
import {Floor} from '../../../src/elements/Floor';
import {Cloud} from '../../../src/elements/props/Cloud';
import {DirectionalLight} from '../../../src/lighting/DirectionalLight';
import {OmniLight} from '../../../src/lighting/OmniLight';
import {TileCollider} from '../../../src/physics/TileCollider';
import {LowPolyTree, LowPolyGrass, LowPolyFlower, LowPolyRock} from '../environment/LowPolyTree';
import {Portal} from '../entities/Portal';
import {Bunny, Deer, Butterfly} from '../entities/Animals';

export const PLAINS_COLS = 16;
export const PLAINS_ROWS = 16;
export const PORTAL_X = 11;
export const PORTAL_Y = 11;

// 树木位置（世界坐标，整数格）
const TREE_TILES: Array<[number, number]> = [
  [1, 1], [1, 2],
  [2, 5], [1, 6],
  [1, 9], [2, 10],
  [3, 13], [1, 14],
  [14, 1], [15, 2],
  [14, 5], [15, 4],
  [13, 8], [14, 9],
  [14, 12], [15, 13],
  [7, 0], [11, 0],
  [0, 7],
  [5, 14],
];

export function buildPlainsScene(): {scene: Scene; portal: Portal; collider: TileCollider} {
  const scene = new Scene({tileW: 64, tileH: 32, cols: PLAINS_COLS, rows: PLAINS_ROWS});
  scene.dynamicLighting = true; // 日夜交替需要每帧重新 bake 地面光照

  // ── 地面 ──────────────────────────────────────────────────────────────────
  scene.addObject(new Floor({
    id: 'floor', cols: PLAINS_COLS, rows: PLAINS_ROWS,
    color: '#5c9e4c', altColor: '#508e40',
  }));

  // ── 碰撞地图 ──────────────────────────────────────────────────────────────
  const collider = new TileCollider(PLAINS_COLS, PLAINS_ROWS);

  // 边界封闭
  for (let i = 0; i < PLAINS_COLS; i++) {
    collider.setWalkable(i, 0, false);
    collider.setWalkable(i, PLAINS_ROWS - 1, false);
  }
  for (let j = 0; j < PLAINS_ROWS; j++) {
    collider.setWalkable(0, j, false);
    collider.setWalkable(PLAINS_COLS - 1, j, false);
  }

  // 树木格不可走
  for (const [tx, ty] of TREE_TILES) {
    collider.setWalkable(tx, ty, false);
  }

  scene.collider = collider;

  // ── 光照 ──────────────────────────────────────────────────────────────────
  scene.addLight(new DirectionalLight({
    angle: 215, elevation: 52, color: '#fff6d8', intensity: 1.0,
  }));
  // 传送阵紫色补光
  scene.addLight(new OmniLight({
    id: 'portal-light',
    x: PORTAL_X, y: PORTAL_Y, z: 55,
    color: '#a060ff', intensity: 0.5, radius: 320,
  }));
  // 梦幻紫蓝补光（场景中央偏右）
  scene.addLight(new OmniLight({
    id: 'dream-light',
    x: 10, y: 6, z: 180,
    color: '#c0a8ff', intensity: 0.22, radius: 1100,
  }));

  // ── 树木 ──────────────────────────────────────────────────────────────────
  const treeOpts = [
    {v: 0, c: '#4a8c3f', s: 1.3, seed: 0.10},
    {v: 1, c: '#3d7a35', s: 1.0, seed: 0.40},
    {v: 2, c: '#5a9e4a', s: 1.2, seed: 0.70},
    {v: 0, c: '#4a8c3f', s: 0.9, seed: 0.20},
    {v: 1, c: '#3d7a35', s: 1.1, seed: 0.55},
    {v: 0, c: '#3d7a35', s: 1.1, seed: 0.50},
    {v: 2, c: '#5a9e4a', s: 1.4, seed: 0.80},
    {v: 1, c: '#4a8c3f', s: 1.0, seed: 0.30},
    {v: 0, c: '#3d7a35', s: 1.2, seed: 0.60},
    {v: 2, c: '#5a9e4a', s: 0.9, seed: 0.90},
    {v: 1, c: '#4a8c3f', s: 1.0, seed: 0.15},
    {v: 0, c: '#3d7a35', s: 0.8, seed: 0.35},
    {v: 2, c: '#5a9e4a', s: 1.1, seed: 0.65},
    {v: 1, c: '#4a8c3f', s: 1.0, seed: 0.45},
    {v: 0, c: '#3d7a35', s: 1.2, seed: 0.75},
    {v: 2, c: '#5a9e4a', s: 0.9, seed: 0.25},
    {v: 1, c: '#4a8c3f', s: 1.1, seed: 0.85},
    {v: 0, c: '#3d7a35', s: 1.0, seed: 0.05},
    {v: 2, c: '#5a9e4a', s: 0.8, seed: 0.95},
    {v: 1, c: '#4a8c3f', s: 1.3, seed: 0.33},
  ];
  for (const [i, [tx, ty]] of TREE_TILES.entries()) {
    const o = treeOpts[i % treeOpts.length];
    scene.addObject(new LowPolyTree(`tree-${i}`, tx + 0.5, ty + 0.5, {
      color: o.c, scale: o.s, seed: o.seed, variant: o.v,
    }));
  }

  // ── 小草 ──────────────────────────────────────────────────────────────────
  const grassPts: Array<[number, number]> = [
    [3, 2], [5, 3], [7, 1], [9, 2], [11, 1], [13, 2],
    [3, 6], [6, 7], [8, 5], [10, 6], [12, 5],
    [2, 10], [4, 11], [6, 12], [8, 11], [10, 12], [12, 11],
    [3, 4], [5, 8], [7, 9], [9, 6], [11, 4], [13, 7],
    [4, 2], [6, 4], [8, 3], [10, 4], [12, 3],
    [2, 8], [4, 9], [6, 10], [8, 9], [10, 10],
    [3, 12], [5, 13], [7, 12], [9, 13], [11, 12],
  ];
  for (const [i, [gx, gy]] of grassPts.entries()) {
    if (Math.hypot(gx - PORTAL_X, gy - PORTAL_Y) < 2.5) {continue;}
    if (!collider.isWalkable(gx, gy)) {continue;}
    scene.addObject(new LowPolyGrass(`grass-${i}`, gx + 0.5, gy + 0.5, {
      color: ['#5aaa40', '#4a9a35', '#6aba50', '#3d8a30'][i % 4],
      height: 9 + (i % 5) * 2, seed: i * 0.28, blades: 3 + (i % 3),
    }));
  }

  // ── 小花 ──────────────────────────────────────────────────────────────────
  const flowerPts: Array<[number, number]> = [
    [3.5, 3.5], [5.5, 2.5], [7.5, 4.5], [4.5, 7.5], [6.5, 9.5],
    [8.5, 8.5], [2.5, 8.5], [9.5, 3.5], [11.5, 2.5], [13.5, 4.5],
    [3.5, 11.5], [5.5, 12.5], [7.5, 13.5], [10.5, 13.5], [12.5, 9.5],
    [4.5, 5.5], [6.5, 6.5], [8.5, 7.5], [10.5, 8.5], [12.5, 7.5],
  ];
  for (const [i, [fx, fy]] of flowerPts.entries()) {
    if (Math.hypot(fx - PORTAL_X, fy - PORTAL_Y) < 2.8) {continue;}
    scene.addObject(new LowPolyFlower(`flower-${i}`, fx, fy, {seed: i * 0.13}));
  }

  // ── 石块 ──────────────────────────────────────────────────────────────────
  const rockPts = [
    {x: 4.5, y: 1.5, size: 0.8, color: '#8a8a9a', seed: 0.2},
    {x: 10.5, y: 2.5, size: 1.1, color: '#7a7a8a', seed: 0.6},
    {x: 2.5, y: 7.5, size: 0.7, color: '#9a9aaa', seed: 0.4},
    {x: 13.5, y: 6.5, size: 0.9, color: '#8a8a9a', seed: 0.8},
    {x: 5.5, y: 11.5, size: 0.6, color: '#7a7a8a', seed: 0.1},
    {x: 12.5, y: 13.5, size: 1.0, color: '#9a9aaa', seed: 0.5},
  ];
  for (const [i, r] of rockPts.entries()) {
    if (Math.hypot(r.x - PORTAL_X, r.y - PORTAL_Y) < 2.5) {continue;}
    scene.addObject(new LowPolyRock(`rock-${i}`, r.x, r.y, {color: r.color, size: r.size, seed: r.seed}));
  }

  // ── 云朵 ──────────────────────────────────────────────────────────────────
  const clouds = [
    {x: 2, y: 1, altitude: 9, speed: 0.28, angle: 0.18, scale: 1.2, seed: 0.18},
    {x: 9, y: 3, altitude: 11, speed: 0.18, angle: -0.12, scale: 0.9, seed: 0.55},
    {x: 5, y: 11, altitude: 8, speed: 0.38, angle: 0.32, scale: 1.4, seed: 0.82},
    {x: 13, y: 8, altitude: 10, speed: 0.14, angle: -0.22, scale: 0.75, seed: 0.40},
    {x: 7, y: 6, altitude: 12, speed: 0.22, angle: 0.08, scale: 1.0, seed: 0.65},
  ];
  for (const [i, c] of clouds.entries()) {
    const cloud = new Cloud({id: `cloud-${i}`, ...c});
    cloud.boundsX = PLAINS_COLS;
    cloud.boundsY = PLAINS_ROWS;
    scene.addObject(cloud);
  }

  // ── 传送阵 ────────────────────────────────────────────────────────────────
  const portal = new Portal('portal', PORTAL_X, PORTAL_Y);
  scene.addObject(portal);

  // ── 动物 ──────────────────────────────────────────────────────────────────
  const animalOpts = {cols: PLAINS_COLS, rows: PLAINS_ROWS};
  // 兔子（5只，分散在草地上）
  const bunnySpots: Array<[number, number, number]> = [
    [4.5, 4.5, 0.1], [8.5, 2.5, 0.4], [3.5, 9.5, 0.7],
    [11.5, 5.5, 0.2], [6.5, 12.5, 0.85],
  ];
  for (const [i, [bx, by, seed]] of bunnySpots.entries()) {
    if (Math.hypot(bx - PORTAL_X, by - PORTAL_Y) < 3) {continue;}
    scene.addObject(new Bunny(`bunny-${i}`, bx, by, {seed, ...animalOpts}));
  }
  // 鹿（2只，在开阔地带）
  scene.addObject(new Deer('deer-0', 6.5, 5.5, {seed: 0.3, ...animalOpts}));
  scene.addObject(new Deer('deer-1', 10.5, 9.5, {seed: 0.7, ...animalOpts}));
  // 蝴蝶（4只，在花朵附近飞舞）
  const butterflySpots: Array<[number, number, number]> = [
    [5.5, 3.5, 0.15], [8.5, 8.5, 0.5], [4.5, 11.5, 0.8], [12.5, 4.5, 0.35],
  ];
  for (const [i, [bfx, bfy, seed]] of butterflySpots.entries()) {
    scene.addObject(new Butterfly(`butterfly-${i}`, bfx, bfy, {seed, ...animalOpts}));
  }

  return {scene, portal, collider};
}
