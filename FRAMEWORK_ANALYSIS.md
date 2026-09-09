# LuxIso 架构分析报告 v5

> 更新日期：2026-09-09
> 基线：Canvas 2D 默认 + WebGL2 预览，382 个 Vitest 测试 / 44 个测试文件（含 v8 覆盖率阈值），11 个 Playwright WebGL 测试

## 执行摘要

LuxIso 已从“功能完整的原型”推进到边界较清晰的 2D 等距引擎内核。v5 完成了 Scene 职责拆分、ECS System 层、构造函数组件查询、EventMap 类型事件、场景运行态序列化，以及深度排序队列优化。此前报告中的“缺少 System、缺少固定时间步、组件使用字符串 key、深度排序没有空间分区、InputManager 无 destroy”等结论均已失效。

当前主要限制不再是基础架构缺失，而是大规模场景下的进一步索引、定制类型序列化、Canvas 阴影投影缓存、音频空间化质量，以及 WebGL2 预览的 golden 审批和浏览器发布矩阵。

## 当前分层

```text
editor/                   开发工具，lib 构建明确排除
webgl-next/               独立 WebGL2 预览、快照提取、GPU 资源与浏览器夹具
core/Engine               RAF、固定时间步、JSON 构建、类型注册表
core/Scene                对象/光源容器、生命周期、相机、System 调度
core/SceneRenderer        剔除、遮挡排序、阴影、lightmap、绘制
core/SceneSerializer      内置 schema 与运行态导出
ecs/                      Entity、Component、System、EventBus、组件
elements/lighting         可渲染对象与光源
physics/animation/audio   碰撞寻路、动画粒子、音频
math/                     投影、颜色、深度排序
```

依赖方向仍以 core 协调基础模块为主。`SceneRenderer` 和 `SceneSerializer` 通过 `type` 引用 Scene，未引入运行时循环依赖。

`webgl-next` 通过 renderer-neutral `RenderSnapshot` 读取同一 Scene 状态，尚未成为公共 `Engine` 构造选项；Canvas2D 仍是已发布库的默认后端。

## WebGL Next 预览

- `SceneExtractor` 已覆盖内置 Floor、Wall、Character、Crystal、Boulder、Chest、Tree、FlowerPatch、Lantern、Cloud、粒子和浮动文本。
- WebGL2 已具备环境光、方向光、点光、全局光、解析阴影投影、GPU shadow mask 缓存、纹理、混合、ID picking、小地图和 DOM 文本桥接。
- 预览场景支持固定步长 A* 点击移动，同时保留 Canvas2D 对照和 fallback。
- 9 个 URL 夹具覆盖四向视图、低/高俯角、夜景、仅全局光和全部灯光禁用。
- Playwright 使用固定 Chromium/SwiftShader、1280×720、DPR 1 验证非空像素和跨帧稳定性，并产出待审批截图；1.5% golden diff 尚未启用为阻断门槛。
- 浏览器生命周期测试会强制丢失/恢复 WebGL context，校验 2 秒恢复门槛、场景状态和像素一致性，并循环验证 renderer dispose 后注册资源计数归零。

## v5 已完成

### Scene 职责拆分

- `Scene.ts` 从 643 行降至约 255 行。
- `SceneRenderer` 持有 lightmap、剔除缓冲区、排序缓存和阴影缓存。
- `SceneSerializer` 负责内置对象与运行态 JSON 导出。
- `Scene.draw()` / `Scene.toJSON()` 公共 API 保持不变。
- lightmap 会在画布尺寸变化时 resize。
- 排序哈希包含对象身份与 AABB，修复同坐标对象交换可见性时复用旧缓存的问题。

### ECS System 层

```ts
class DeathSystem extends System {
  readonly query = [HealthComponent];
  update(entities: Entity[], dt: number): void {
    for (const entity of entities) {
      if (entity.getComponent(HealthComponent)?.isDead) {
        this.scene?.removeById(entity.id);
      }
    }
  }
}

scene.addSystem(new DeathSystem());
```

- System 按 priority 稳定排序。
- 支持 variable update 与 fixedUpdate。
- 查询要求实体具备全部组件构造函数。
- 匹配数组复用，支持运行时添加/移除组件及可见性变化。
- 具备 attach/detach 生命周期和跨 Scene 实例保护。

### ECS 契约统一

- `Entity` 的 Map key 为组件构造函数引用。
- `Validator.requireComponent()` / `validateComponents()` 已迁移到 `ComponentCtor`。
- 同类型组件替换会先调用旧组件 `onDetach()`。
- `componentType` 仅保留为可选诊断标签，不参与查询。

### 类型安全 EventBus

```ts
interface GameEvents {
  damage: { amount: number };
  score: { value: number };
}

const bus = new EventBus<GameEvents>();
```

事件名与 payload 由同一个 EventMap 约束。默认 `new EventBus()` 仍是开放字符串总线，`globalBus` 使用内置 `LuxIsoEventMap`。组件只依赖所需事件的 `EventEmitter<Pick<...>>`，允许应用扩展事件集合。

### 序列化闭环

内置 schema 现可往返：

- Scene 名称、尺寸、环境光、dynamicLighting、IsoView
- Camera x/y/zoom/lerpFactor
- 光源 ID、enabled、全局光、falloff、方向与强度
- Floor、Wall、Character、Cloud、Crystal、Boulder、Chest
- Health 最大值与 TileCollider walkable 网格

自定义 prop/light 可通过 Engine 注册表反序列化；自定义 prop 的自动序列化仍需要后续 serializer registry。

### 深度排序

- 2D 空间桶限制候选 AABB 对。
- 数字 pair key 去重。
- min-heap Kahn queue 将队列操作降为 O(log n)。
- 移除了 orphan 全局二次比较和 `globalThis` 调试写入。
- `Scene.sortedObjects` 提供显式诊断入口。

稠密对象全部落入同一桶时，候选图构建仍可能退化为 O(n²)；这是 broad phase 的最坏情况，不代表每帧固定两两比较。静态场景会复用排序缓存。

## 剩余问题

| 优先级 | 问题 | 建议 |
|---|---|---|
| P1 | example-05 移动绕过 `MovementComponent` | `ClickMover` 直接改 `position`；且只有草原场景建了 `TileCollider`，湖水/深海的 hero 只受边界钳制，不做碰撞 |
| P1 | example-05 天空绘制函数仍集中在 main.ts | 拆到 environment 模块 |
| P1 | 自定义 prop 没有配套 serializer registry | 为注册表增加 serialize 回调或独立注册 API |
| P1 | WebGL golden 基线尚未审批 | 目前 CI 只断言颜色直方图启发式，`ACCEPTANCE.md` 里的 1.5% diff 门槛尚未生效 |
| P1 | Playwright 跑的是 Vite dev server 而非构建产物 | `playwright.webgl.config.ts` 启动 `npm run dev`，发布包从未被浏览器测试覆盖 |
| P2 | `ParticleSystem` 47% 覆盖率偏低 | 其 preset 工厂同时存在忽略入参的问题，见 README API 说明 |
| P2 | System 每次调度扫描所有 Entity × System | 达到千级实体后引入 query/archetype 缓存 |
| P2 | 稠密深度桶仍可能 O(n²) | 基准验证后考虑 sweep-and-prune 或分层 chunk |
| P2 | WebGL context-loss 尚未覆盖完整浏览器矩阵 | Chromium/SwiftShader 自动化已完成；Phase 5 扩展到 Firefox、Safari 和真实 GPU |
| P2 | `EditorRenderer` 每次状态变更全量重建场景 | 按帧防抖，或对纯变换编辑原地改对象 |
| P2 | `webgl-next` `TextureRegistry` 不淘汰 | 按帧引用计数或 LRU 淘汰；`dispose()` 应删除自己创建的 GL 纹理 |
| P3 | `AudioManager.spatialVolume()` 仍是手算距离衰减 | `playSfx({ spatial })` 已走 `PannerNode` + HRTF，该静态方法是遗留路径 |
| P3 | 地图未分块 | 大地图引入 tile chunks 与脏区重绘 |

## v5.1 修复（审计驱动）

一轮针对文档与代码的审计发现了若干单测未覆盖的缺陷，均已修复并配回归测试：

- `Wall.drawFace` 的开洞逻辑会覆盖墙面路径，任何带 `openings` 的墙从未被填充。
- `Camera.worldToScreen`/`screenToWorld` 与 `applyTransform` 的 rotation/elevation
  合成顺序相反；`S_elev` 非均匀，两者不可交换，导致斜视+旋转下拾取与渲染错位。
- `TileCollider.canOccupy` 的 epsilon 使窄 footprint 跳过全部检查返回 true；
  `sweepMove` 对非单调谓词做二分且终点无碰撞即放行，快速物体可穿一格厚墙。
- `Floor` 在近零光照时给贴图砖缓存空串，`draw` 跳过 multiply 叠加 → 暗处全亮。
- `TileCollider` 新增 `version` 计数器，`PathCache` 据此自动失效，修复开关门后
  仍返回旧路径。
- A* string-pull 的 Bresenham LoS 会斜穿墙角，把合法路径拉直成非法路径。
- `BaseLight` 新增稳定 `uid`/`cacheKey`；此前 `ShadowCaster` 在光源无 `id` 时按
  坐标做键，移动光每帧新增缓存条目且永不释放。
- `AudioManager` 补 `dispose()` 与播放结束节点回收；失败的 fetch 不再永久污染 URL。
- `Engine` 构造校验 2D context，`loadScene` 全链路错误信息带 URL，场景尺寸非法时
  立即抛错而非退化成全阻挡网格。
- `Camera.lerpFactor` 钳制到 [0,1]；`Engine.stop()` 在帧回调内生效。
- 编辑器属性面板与对象列表的 `innerHTML` 插值全部转义（导入 JSON 为不可信输入）。
- `tsconfig.json` 的 `include` 扩展到 `examples`、`webgl-next/e2e` 与根配置文件，
  此前 8 个 demo 只过 esbuild、完全没有类型检查。
- 接入 v8 覆盖率与分模块阈值门禁。首次测量暴露 `src/audio` 覆盖率为 **0%**——
  `AudioManager` 289 行、零测试，正是上面两个音频缺陷能长期存活的原因；已补 13 个
  用例（其中 7 个在修复前的版本上失败）。
- `EditorRenderer` 场景重建按帧合并；`TextureRegistry` 加载失败时回退白纹理并上报，
  此前 `record.failed` 被写入却从不读取，404/CORS 会让整段几何永久不绘制且无提示。
- 补测 `ObjectPool` / `InputMap` / `AssetLoader`（此前分别为 0% / 0% / 20%），过程中
  发现三个缺陷：`InputMap.define()` 覆盖动作时不解绑旧键，旧键仍能触发该动作；
  `InputMap.remove()` 只清了一个从未被读取的簿记 map，InputManager 侧的回调仍然存活；
  `AssetLoader.unload()` 的行为与自身文档相反，飞行中的加载完成后仍会把已释放的资源
  写回缓存。`ObjectPool.prewarm()` 也不再能越过 `maxSize` 分配永远取不出来的对象。
- 补测 `DirectionalAnimator`（0%→99%）时发现 `playOnce()` 不覆盖 clip 自身的 `loop`
  标志，而 `buildSheet` 生成的每个 clip 都默认 `loop: true`——用文档推荐方式造出来的
  一次性动画会永远循环、完成回调永不触发、也回不到 `returnTo`。类注释里的 N 方向
  fallback 链同时也与实现不符。
- 统一 Z 单位到屏幕像素。此前 `position.z` 用像素、AABB 的 `baseZ`/`maxZ` 用「世界 Z
  单位」并靠硬编码 `Z_UNITS_PER_PX = 1/16` 换算，该常量只在 `tileH = 32` 时满足它自己
  声明的「1 单位 = tileH/2」；而 WebGL 提取路径又把世界 Z 乘回 `tileH/2`，于是任何
  非标准 tileH 下两个后端对同一个 z 的落点不一致。现在只有一个单位，
  `Z_UNITS_PER_PX` 与 `legacyPixelsToWorldZ` 一并删除，`projectIso` 与 `project()`
  在多组 tileW/tileH 下逐点等价（有测试钉住）。`depthSort` 的隐含「1 单位」兜底改为
  导出的 `MIN_Z_EXTENT_PX = 16`。



## 当前评价

| 维度 | 评分 | 说明 |
|---|:---:|---|
| 模块分层 | 9/10 | Scene 渲染与序列化职责已拆分 |
| ECS 设计 | 8/10 | 构造函数查询、System、生命周期完整；尚无 archetype |
| 渲染管线 | 8/10 | Canvas 完整；WebGL 预览已覆盖核心 pass，尚待 golden 和浏览器矩阵 |
| 类型安全 | 9/10 | ComponentCtor 与 EventMap 覆盖核心扩展面；`tsc` 现已覆盖 examples 与 e2e |
| 可扩展性 | 8/10 | 加载注册表与自定义事件良好；序列化注册表待补 |
| 文档质量 | 8/10 | README 与本报告已同步当前实现 |
| 测试覆盖 | 8/10 | 382 个单测 + 11 个浏览器测试；已接入 v8 覆盖率与分模块阈值（整体 61.6% 语句 / 56.2% 分支），仍无 approved golden 门槛 |
| 综合 | 8.3/10 | 架构短板已大幅收敛，下一阶段应由 profiling 驱动 |

测试数量不等于覆盖率。`vitest.config.ts` 现已按模块设定阈值（math/physics/lighting
90% 语句、ecs 82%、audio 67%、animation 62%、core 59%、elements 57%，整体 61%），
并在 CI 中作为门禁。阈值一律设在当前值略下方，只能随新测试上调，不允许为了让构建
通过而下调。

补测的实际收益是找 bug，而不是把百分比推高：`AudioManager`（0%→68%）、`ObjectPool`
（0%→100%）、`InputMap`（0%→98%）、`AssetLoader`（20%→98%）、`DirectionalAnimator`
（0%→99%）这五轮，每一轮都在原本无人覆盖的分支里发现了缺陷。
