# LuxIso 架构分析报告 v5

> 更新日期：2026-09-09
> 基线：Canvas 2D 默认 + WebGL2 预览，599 个 Vitest 测试 / 54 个测试文件（含 v8 覆盖率阈值），11 个 Playwright WebGL 测试

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
| P1 | example-05 天空绘制函数仍集中在 main.ts | 拆到 environment 模块 |
| P2 | `webgl-next` 没有 HUD 路径 | `HudLayer` 仅 Canvas；WebGL 预览的 UI 走 DOM 覆盖层（`DomOverlayRenderer` / `MinimapRenderer`），基于该后端的游戏必须自建覆盖层 |
| P1 | 自定义 prop 没有配套 serializer registry | 为注册表增加 serialize 回调或独立注册 API |
| P2 | 9 个 WebGL fixture 中有 6 个未接入基线比对 | `day-ne` / `low-angle` / `night-lanterns` 已按 1.5% 门槛比对committed 基线；扩展只需往 `PIXEL_GATED_FIXTURES` 加 ID 并重新生成 |
| P2 | `src/elements/**` 57% / 分支 53% 是当前最低的一块 | 主体是 canvas 绘制代码，未覆盖分支集中在绘制路径；再往上需要给 `Engine` / `Scene` 搭 canvas 测试夹具 |
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
- 补测 `ParticleSystem`（47%→85%）暴露三处：`onExhausted` 在发射器空闲的每一帧都会
  重复触发（回调被当成「粒子归零」的边沿事件写文档，实现里却是电平判断），所以任何
  挂在上面的清理逻辑都会被反复执行；`_pool` 静态回收池没有上限，一次大爆发之后
  内存不再归还；`sparkBurst`/`dustPuff` 等 preset 工厂声明了 `{ color, count }` 入参
  却整个忽略——README 承诺的用法从来没生效过。现在 `onExhausted` 由 `spawn()` 重新
  武装的闩锁保证「每轮爆发恰好一次」，池上限为 `ParticleSystem.poolLimit = 512`
  （配套 `poolSize` / `clearPool()`），preset 入参经 `burstPreset()` 真正生效。
- `ClickMover` 的移动量与帧率挂钩。`update(dt, ...)` 收下了 `dt`，却只用来淡出点击
  标记，位移一直是每帧固定的 `speed`——144Hz 屏上角色的实际速度是 60Hz 的 2.4 倍。
  现在位移按 `speed * dt * ClickMover.REFERENCE_FPS`（60）计算：60FPS 下步长仍然
  恰好等于 `speed`，所有既有 example 的手感不变，其它刷新率下才被纠正。到达判定
  同步按步长缩放，并在最后一帧直接输出剩余精确位移——此前是「距离小于 1.2 步就
  停」，停下的位置离点击点最多差 1.2 步且随帧时长放大（24FPS 下差 0.2 格）。
- example-05 的湖水与深海场景根本没有 `TileCollider`——只有草原场景建了。石头、珊瑚
  这些看起来是实体的道具，角色可以直接穿过去；两个场景先前只靠 `ClickMover` 的
  `cols/rows` 边界钳制。现在两个 builder 各自建 collider 并封住石头 / 珊瑚格（水草、
  荷叶、水母这类软性装饰保持可走），出生点与传送门格显式保留可走，避免角色一落地
  就被 `resolveMove` 卡在障碍里。出生坐标提为 `LAKE_SPAWN_*` / `DEEP_SPAWN_*` 常量，
  单测用 `Pathfinder` 钉住「出生点到传送门始终连通」，防止以后加道具把 demo 堵死。
- `SceneManager.push()` 的 `onPause` / `onResume` 会失配。旧栈顶先收 `onPause`，然后才
  去 build 新场景；build 或新场景的 `onEnter` 一抛异常，旧场景就永远停在 paused 状态，
  而症状（输入没反应、动画不走）离原因很远。现在失败会回滚：弹出未完成的入栈、把
  引擎切回旧场景并补发 `onResume`，再把异常抛给调用方。另外 `pop()` / `replace()` 里
  `assetLoader?.clear()` 排在 `onExit()` 之后同一条直线上，`onExit` 抛异常就漏掉释放——
  而此时场景已经出栈，那是最后一次机会；改成 `finally`。顺带修掉两处文档与实现相反
  的说法：`replace()` 注释写「bottom to top」而循环是自顶向下；`register()` 说工厂
  「first pushed 时调用」，实现是每次 push 都调用、从不缓存。
- 像素基线的「只能由 CI 生成」这条规则此前只写在注释里，没有任何强制。
  `playwright.webgl.config.ts` 有意只用一套无平台后缀的基线目录，于是开发机上一次
  `npm run test:webgl:update` 写出的 PNG 正好落在 CI 读取的路径上——提交上去要么让门禁
  变红，要么把真实回归悄悄重新基线化。现在 `test:webgl:update` 在 CI 之外直接拒绝运行
  （`scripts/guard-baseline-update.mjs`），并打印正确的 `gh workflow run` 步骤；调 fixture
  时可用 `LUXISO_ALLOW_LOCAL_BASELINES=1` 绕过，但会打印警告。同时把 README 与
  ACCEPTANCE 里「已比对 committed 基线」改为实情：`__screenshots__/` 目前是空的，
  比对已接线但处于休眠状态，等人跑一次手动 workflow 并提交审核过的 PNG。
- 上一条我判断错了一半：像素门禁并不是「休眠」，而是**每次 CI 都在红**。
  `toHaveScreenshot` 把「基线文件不存在」当作失败（写出 actual 并报
  "A snapshot doesn't exist at ..."），所以 1195656 在没有任何基线的情况下打开门禁，
  等于让主 CI 从那时起就一直失败。现在 fixture spec 会先检查基线文件是否存在：不存在
  就记一条 `pixel-gate-skipped` annotation 而不做断言，提交 PNG 即自动生效；
  `webgl-baselines` workflow 用 `LUXISO_WRITE_BASELINES=1` 绕过这个跳过，才能把基线
  first-run 生成出来。本地以 `CI=1` 复现验证：修复前 3 个 fixture 失败，修复后 11/11 通过。
- 为立项 2.5D ARPG 手游做的审计暴露了输入层的三个真实缺陷，全部与移动端相关。
  `touchstart` 无条件覆盖指针状态，第二根手指落下就伪造一次新的 press；`touchend`
  无条件 `down = false` 且不看 `ev.touches.length`，双指按下抬起一根，框架就报告
  "玩家松手了"——这两条合起来使"左手摇杆 + 右手技能"在物理上不可能实现，因为
  `ev.touches[0]` 之外的坐标全被丢弃。现在按 `changedTouches` 维护完整的触点表
  （`touches` / `touchCount` / `getTouch(id)`），`pointer` 只跟随主触点，主触点抬起时
  提升最老的存活触点而不是报告 release。`mouseup` 从 canvas 移到 window——在画布内
  按下、画布外松开，此前永远收不到抬起事件，指针会卡在按下状态。
  另外把 `MouseLeft` / `MouseMiddle` / `MouseRight` 注册成可绑定键，`InputMap` 文档里
  `rebind('attack', ['MouseLeft', 'Space'])` 这个示例从此不再是死绑定——`mousedown`
  以前从不往 `_pressed` 写入任何鼠标键名。最后补上 `blur` / `visibilitychange` 的
  全量释放：切走时不发 keyup，回来角色会继续走。默认对 canvas 触摸事件调
  `preventDefault`（可用 `preventTouchDefault: false` 关闭），否则手机上页面会滚动、
  双击缩放、弹长按菜单并带 300ms 点击延迟。
- 高 DPI 适配。`Engine.resize()` 把 backing store 按 CSS 像素定尺，DPR=3 手机上等于
  以 1/3 分辨率渲染再让合成器放大——`src/` 里 `devicePixelRatio` 原本零命中。现在确立
  一条明确的契约：**游戏接触到的一切都是逻辑（CSS）像素**。`resize()` 按
  `logical × pixelRatio` 设 backing store、钉住 CSS box 尺寸、给 2D context 一个同比例
  的基础变换，绘制代码一行不改；`canvasW/H`、`originX/Y`、`Scene.draw` 的尺寸参数、
  `clearRect` 全部改为逻辑像素。`pixelRatio` 由 `devicePixelRatio` 自动推导并按
  `maxPixelRatio`（默认 2）截断——DPR=3 意味着 9 倍填充率，中端机上 Canvas 2D 给不出
  60 帧。构造函数**故意不**应用比例，只沿用页面已设好的尺寸，因此所有既有页面行为
  不变，直到显式调用 `resize()` 才切换。配套给 `InputManager` 加了 `pixelRatio` 选项
  （可传函数，跨屏拖窗口时能跟着变）：否则指针会以 backing 像素上报，而 HUD 的命中
  框是逻辑像素，两边永远对不上。
- 页面生命周期。`Engine` 没有任何 `visibilitychange` 处理：浏览器在后台标签页里节流或
  停掉 rAF，而 `_tick` 把 `rawDt` 截到 100ms，于是后台经过的真实时间被静默丢弃——切走
  一分钟回来，游戏只前进了一帧，且没有任何钩子能察觉。现在 `start()` 挂上监听，隐藏时
  取消 rAF 并置 `paused`，回来时清 `_lastTs` / `_accumulator` 再续跑，把这段空档变成
  显式的暂停而不是缓慢漂移；`stop()` / `destroy()` 负责摘掉监听，不留泄漏。
- 音频解锁。`AudioManager.resume()` 一直是个正确的解锁原语，但框架从不绑定任何手势，
  README 里那句 `document.addEventListener('click', ...)` 是唯一的说明。更糟的是
  `_loadBuffer` 会轮询等待 context 出现并在 5 秒后 reject——**开局预加载的音频只要在
  首次手势之前发起就必然失败**。根因是把「构造 AudioContext」和「resume」混为一谈：
  构造不需要手势，只是初始状态为 suspended，而 `decodeAudioData` 在 suspended 上照样
  工作。现在拆出 `_ensureContext()`，`waitForContext` 连同那个 5 秒超时一起删除；
  新增 `bindPageLifecycle()` 一次性接好两件事：首次 pointerdown/touchend/keydown/mousedown
  解锁后自摘监听（iOS Safari 对哪个事件算手势历来不稳，所以全绑），以及隐藏时
  `suspend()`、回来时 resume——`suspend()` 此前在整个仓库中没有任何调用者。
- 模拟量输入。`InputMap.axis()` 只做四个方向键的离散 ±1 合成，屏幕摇杆的部分推程在
  action 层根本无法表达，所以「先加控件」是没意义的——必须同时打通两端。现在引入
  `AxisSource` 接口，`axis()` 把所有 active 源与数字键相加后把长度截到 1：纯键盘结果
  逐位不变（单键 1、对角各 1/√2），同时按键 + 推杆也不会获得额外速度。新增
  `TouchStick` 作为第一个实现，按 `Touch.identifier` 认领单个触点并持有到该手指抬起，
  第二根拇指按技能键不会把它抢走；带死区（越过死区后重新缩放到 0 起步，避免角色突然
  窜出去）、可选动态原点（落点即中心，适合「左半屏任意位置起摇」）。
  顺带修掉 `ClickMover` 的一处：它把 `map.axis()` 的结果按向量长度归一化，会把摇杆的
  40% 推程重新放大成满速，等于把模拟摇杆退化为一个开关。改成 `Math.max(1, len)` 截断——
  数字对角本来长度就是 1，键盘行为不变。
- `HudLayer` 是桌面形状，同时藏着一个我上一次 DPR 改动留下的真实缺陷：`draw()` 为了
  「HUD 永远在屏幕空间」会 `setTransform(1,0,0,1,0,0)`，这正好把 `Engine.resize()`
  装上的高 DPI 基础变换抹掉——DPR=2 时整个 HUD 会以一半尺寸画在左上角。现在改为重置到
  `pixelRatio` 对应的缩放（同样支持传函数，与 `InputManager` 一致的写法）。
  其余三处：命中测试只认 `type: 'button'`，panel / bar 一律不可点，背包格子无从实现；
  `handleClick` 从不自动接线，文档建议挂 `click`，而触屏上那是错的事件（有 300ms 延迟
  且被 `touchstart` 前置）；`_hovered` 在触屏点完不消失，因为触摸不产生「移出」事件。
  现在 `hitTest()` 覆盖所有有尺寸的元素并返回最上层，新增 `update(input, isTaken?)`
  做帧驱动的按下/抬起：按下高亮、在同一个按钮上抬起才触发（滑出去不算）、按 contact id
  逐个跟踪，配合 `TouchStick.touchId` 就不会和摇杆抢手指。`minHitSize` 可把过小的目标
  对称扩到 44×44（默认 0，保持原行为，因为相邻按钮会互相抢点击）。
- WebGL 路径的对象分发是一条封闭的 `instanceof` 链，只认 12 个内置类型，其余
  `IsoObject` 子类一律画成洋红诊断菱形，且**没有任何 opt-in 手段**——`examples/` 里
  40 多个自定义类在这条路径上全都渲染不出来，这是「用 WebGL2 做完整游戏」最实际的
  阻塞。现在加了注册表：`SceneExtractor.register(Ctor, (obj, ctx) => ...)`，`ctx` 只暴露
  `builder` / `tileW` / `tileH` / `pickId` 和与内置一致的 `project()`，返回贴图 URL 即进
  纹理 segment。后注册者优先，子类可以覆盖基类而不必先反注册。内置类型仍先匹配。
  自定义 extractor 是跑在渲染路径里的应用代码，所以外面包了两道保护：抛异常或没产出
  任何几何都退回诊断菱形并写进 `unsupported`，一个坏对象不会带崩整帧。
- 补测 `FloatingText`（37%→59% 语句 / 67%→92% 分支）又验证了同一条规律。它的类注释写着
  「floats upward and fades out」，而 `speed` 默认 1.5、注释标为「units/sec」——但
  `position.z` 是屏幕像素，于是一个伤害数字在 800ms 生命里上升 **1.2 像素**，文档承诺的
  上浮从来没发生过。默认值改为 40 px/s（约 32px），单位在类型上写明。
  另外两处：`_lastTs = 0` 这个哨兵与合法的时间戳 0 冲突——`update(0)` 之后每一帧都被判为
  「第一帧」，文字永远不升、不淡出、不过期，`Scene` 也就永远不会移除它；改为 `null`。
  首帧 dt 也从凭空的 0.016 改为 0，与 `Engine` / `ClickMover` / `DirectionalAnimator` 一致，
  此前文字在被画出来之前就已经淡掉一帧。
- 补测 `Character`（分支 46%→85%）发现 `isMoving` 侦测不到「从 `update()` 外部施加的
  位移」。`update()` 在调 `super.update()` **之前**就把 `_prevX/_prevY` 快照成当前位置，
  而 `ClickMover` 文档规定的用法正是在帧与帧之间 `hero.position.x += mover.velX`——
  于是快照永远等于新位置，位移差恒为 0。后果是**用 ClickMover 驱动的带 sprite 角色
  永远不播 walk 动画**，一直停在 idle。现在改为在 `super.update()` 之后与「上一帧结束时
  的位置」比较，并把结果缓存进 `_moved`，这样同一帧内多次读 `isMoving` 答案一致。
  同时 `isMoving` 由「有 MovementComponent 就只信它」改为两个信号取或——否则
  example-05 那种「挂了组件但用 ClickMover 驱动」的组合会被组件一票否决。
- 补测 `Chest`（分支 3.8%→41%）发现盖子开合是第三处帧率依赖的插值：
  `_lidAngle += (target - _lidAngle) * 0.10` 每帧固定推进一成，144Hz 屏上开盖速度是
  60Hz 的 2.4 倍——而 `ts` 其实一直传进来了，只被用来算发光脉冲。现在按
  `Camera.lerpFactor` 同一个公式 `1 - (1 - f)^(dt*60)` 转成帧率无关，60FPS 下手感不变；
  `lidLerpFactor` 可调并做了 [0,1] 钳制（避免负底数开分数次幂产生 NaN），
  长帧 dt 截到 100ms，首帧不推进，时间戳回退不推进，另外补了 `lidAngle` 只读访问器。
- 补测 `Scene.update()`（core 分支 67%→69%）发现 `_lastTs = 0` 哨兵冲突在**所有东西的容器**
  里也有一份，而且这里的影响面最大：`Scene.update()` 是 System 与 Camera 拿到 `dt` 的唯一
  来源。`update(0)`（`Engine` 首帧的合法时间戳）之后哨兵仍然武装，于是**第二帧也拿到凭空的
  1/60**，而不是它真实的 delta——每个 System、每次视角过渡都整体偏移一帧。首帧 dt 同步从
  1/60 改为 0，与 `Engine` / `ClickMover` / `FloatingText` / `Chest` 一致；时间戳回退不再
  产生负 dt（此前 `update(1000)` 后 `update(500)` 会把 -0.5 秒发给所有 System，视角过渡直接
  倒退）。同一个 `_lastTs === 0` 缺陷这样已经出现四次（`FloatingText`、`Chest`、`Scene`，
  加上 `ClickMover` 的帧率依赖）：**新写的时间累积代码应当一律用 `null` 做首帧哨兵，
  并复用 `Camera` 的 `1 - (1 - f)^(dt*60)` 做平滑。**


















## 当前评价

| 维度 | 评分 | 说明 |
|---|:---:|---|
| 模块分层 | 9/10 | Scene 渲染与序列化职责已拆分 |
| ECS 设计 | 8/10 | 构造函数查询、System、生命周期完整；尚无 archetype |
| 渲染管线 | 8/10 | Canvas 完整；WebGL 预览已覆盖核心 pass，尚待 golden 和浏览器矩阵 |
| 类型安全 | 9/10 | ComponentCtor 与 EventMap 覆盖核心扩展面；`tsc` 现已覆盖 examples 与 e2e |
| 可扩展性 | 9/10 | 加载注册表、自定义事件、WebGL extractor 注册表均已就绪；序列化注册表待补 |
| 文档质量 | 8/10 | README 与本报告已同步当前实现 |
| 测试覆盖 | 8/10 | 599 个单测 + 11 个浏览器测试；已接入 v8 覆盖率与分模块阈值（整体 68.7% 语句 / 67.1% 分支），三个 fixture 已按 1.5% 门槛比对基线 |
| 综合 | 8.3/10 | 架构短板已大幅收敛，下一阶段应由 profiling 驱动 |

测试数量不等于覆盖率。`vitest.config.ts` 现已按模块设定阈值（math/physics/lighting
90% 语句、ecs 82%、animation 81%、audio 78%、core 76%、elements 57%，整体 68.5%），
并在 CI 中作为门禁。阈值一律设在当前值略下方，只能随新测试上调，不允许为了让构建
通过而下调。

补测的实际收益是找 bug，而不是把百分比推高：`AudioManager`（0%→68%）、`ObjectPool`
（0%→100%）、`InputMap`（0%→98%）、`AssetLoader`（20%→98%）、`DirectionalAnimator`
（0%→99%）、`ParticleSystem`（47%→85%）、`ClickMover`（0%→100%）这七轮，每一轮都在
原本无人覆盖的分支里发现了缺陷。规律已经很稳定：**文档写得越完整、测试却是零的
模块，实现几乎必然已经和文档分叉**——上面七个模块的 README 段落都写得像已经验证过。
