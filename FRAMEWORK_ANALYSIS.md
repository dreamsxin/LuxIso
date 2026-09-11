# LuxIso 架构分析报告 v5

> 更新日期：2026-09-09
> 基线：Canvas 2D 默认 + WebGL2 预览，816 个 Vitest 测试 / 66 个测试文件（含 v8 覆盖率阈值），11 个 Playwright WebGL 测试

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
- Playwright 使用固定 Chromium/SwiftShader、1280×720、DPR 1 验证非空像素和跨帧稳定性；`day-ne` / `low-angle` / `night-lanterns` 三个 fixture 的基线已提交，1.5% golden diff 已作为阻断门禁生效，其余六个仍只有启发式断言。
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

自定义 prop/light 可通过 Engine 注册表反序列化；`SceneSerializer.register()` / `registerLight()` 补上了序列化方向（详见下方审计条目），两个方向各注册一次即完成往返。

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
- 以 ARPG 的动作需求（冲刺、击退、怪物寻路）为镜头补测 `MovementComponent`
  （ecs 分支 78%→83%），发现四处缺陷，其中三处是**穿墙**：
  - 到达判定分支 `if (dist <= step)` 直接 `pos = target` 赋值，完全绕过碰撞。任何一帧
    能覆盖剩余距离的移动都会瞬移过去——冲刺速度（speed 30 × 钳制后的 100ms 帧 = 3 格步长）
    必然触发。现在落地位移同样过碰撞，被挡住就停下而不是穿过去。
  - `nudge()` 文档写着「with collision resolution」，但 `TileCollider.resolveMove()`
    只测终点脚印，不测路径。击退这种大位移（ARPG 里最常见的用法）直接跨过一格厚的墙。
    现在位移超过脚印半径就走 `sweepMove()` 连续检测，短位移仍走 `resolveMove()`
    以保留贴墙滑行。`_integrate()` 的常规步长共用同一条 `_resolve()`。
  - 正面撞墙时「放弃」的判断带了 `&& this._waypoints.length > 0`，只有寻路才生效。
    用 `moveTo()` 直接走向墙的对象会永远保持 `isMoving === true`、永远不触发 `arrival`，
    并且每帧都在原地发一次 `move` 事件。现在两条路径一致处理。
  - `_lastTs === 0` 哨兵（第五处）：`update(0)` 之后紧接着的那一帧被整帧丢弃。
  另外 `followPath([])` 过去会把空数组 `shift()` 出 `undefined` 并保留上一个目标，
  对象继续走向旧终点；现在空路径等于取消移动。
- ARPG 的攻击动作暴露了一处**已经修过一次但漏了另一半**的缺陷。`DirectionalAnimator`
  早先补测时发现 `playOnce` 必须覆盖 clip 自身的 `loop` 标志，为此加了 `_forceOnce`；
  但 `Character` 和 `AnimationComponent` 实际用的是另一个类 `AnimationController`，
  它的 `playOnce` 只重置了播放进度，函数体里那句注释「Force non-looping for this
  playback」从来没有对应实现。于是只要 clip 是 `loop: true`（或干脆没写 `loop`，默认
  就是循环），attack/hurt/die 这类一次性动作会永远循环：完成回调不触发，也永远不回到
  idle。现在两个类共用同一套语义，`play()` 与 `reset()` 会解除一次性标志。
  规律再次成立：**同一个缺陷在孪生类里往往各有一份，修一处不等于修完。**
  `AnimationComponent` 的 `_lastTs === 0` 是第六处哨兵冲突，另外它把负 dt 直接喂给
  控制器，时间戳回退会让动画倒放；现在与其它模块一致钳到 [0, 0.1]。
- 顺着 ARPG 的仇恨范围补测 `TriggerZoneComponent`（17 个用例，ecs 分支 84%→87%），
  这一轮**没有发现实现缺陷**——enter/exit 各只触发一次、目标中途增删、跟随宿主移动、
  运行时改半径、双 Set 交换全部正确。只有文档错了：选项注释写的是「Half-size ...
  the zone is a square」，实现用的是 `Math.hypot(dx, dy) <= r`，即圆形；
  README 里写的「circle enter/exit」才是对的。另外 `insideIds` 返回的是会被下一次
  `update()` 交换并清空的实时 Set，这一点原先完全没有说明，现在写进了注释。
  记一笔反例：**「文档完整但零测试必然分叉」这条规律有例外，这里分叉的是文档本身。**
- 技能冷却与伤害数值这两条 ARPG 主干各查出问题（ecs 分支 87%→87.4%，新增 23 个用例）。
  `TimerComponent`：
  - 每帧只判一次 `if (_elapsed >= duration)`，**周期比帧长短时会永久欠账**。50ms 的冷却
    落在 200ms 的帧上只触发一次而不是四次，`_elapsed` 的余额每帧净增，实际频率被压到帧率。
    现在按 `while` 补齐（并守住 `duration <= 0` 不进死循环）。
  - `pause()` 不清 `_lastTs`，暂停十秒再 `start()`，恢复后的第一帧会把被 dt 上限截到的
    0.5 秒直接计入——暂停偷走了半秒冷却。现在 `pause()` 与 `restart()` 一样重置基准。
  - `_lastTs === 0` 是第七处哨兵冲突；时间戳回退也不再让计时器倒退。
  `HealthComponent`：
  - `takeDamage(负数)` 会**治疗并越过 max**（`heal()` 里的钳制在这条路径上不存在），
    `heal(负数)` 则会把 hp 打成负数，而 `heal()` 没有死亡分支——`isDead` 变成 true，
    但 `death` 事件和 `onDeath` 回调都不触发。两侧现在都钳到 0。
  - `setMax(0)` 会让 `fraction` 变成 Infinity/NaN 且 hp 归零（同样静默地「死亡」），
    现在非正数直接忽略。
- `TweenComponent` 是同一批时间账缺陷的第三处，而且它自己就有两套哨兵：字段初始值是
  `-1`（正确，首帧只对表不推进），但 `restart()` 写回的是 **0**——于是重启后的下一帧
  按「now - 0」算 delta 并被截到 0.5 秒上限，**补间瞬间跳到半秒后的位置**。
  另外三处：`pause()` 不重置基准，暂停 19 秒再 `resume()` 会补上 0.5 秒；
  `delay` 用完那一帧的剩余时间被直接丢弃（0.1 秒延迟碰上 0.3 秒的帧，白扔 0.2 秒）；
  循环边界把 `_elapsed` 归零，跨界那帧的溢出同样丢掉，导致每次 repeat 都比 duration 慢。
  现在延迟按消耗量结算并把余量交给补间，循环边界改成 `_elapsed -= duration`，
  负 dt 一并钳掉。合计：**同一个「时间账要么被凭空发明、要么被悄悄丢弃」的模式，
  在 8 个模块里各出现一次。**
- 第八处就在 `Engine._tick()` 自己：`_lastTs === 0` 既是初始哨兵，也是切回前台时
  「丢弃隐藏时段」的标记，于是一个合法的 rAF 时间戳 0 会让紧随其后的整帧被丢掉——
  固定步长物理在那一帧完全不推进。另外 `rawDt` 没有下限，时间戳回退会把 `_accumulator`
  推成负数，**接下来好几帧都在还这笔债**（物理停摆）而不只是这一帧不动。
  两处都改成 `null` 哨兵 + [0, 0.1] 钳制，并补了 5 个直接驱动 rAF 回调的测试。
- ARPG 的关卡/结算切换用到 `SceneTransition`，它是 `src/` 里体量最大的 0% 覆盖模块
  （89 条语句、文档写得最全），照旧分叉了四处：
  - `Phase` 联合类型里声明了 `'hold'`，**代码从来没有进入过这个状态**。`playIn` 完成即
    回到 `idle`，`draw()` 随之停止绘制——于是 `between()` 里 `await onCovered()`
    加载新场景的那几十帧，屏幕露出的是**旧场景**，加载完再硬切。现在 `in` 完成后转入
    `hold` 并持续按满覆盖绘制，只有 `out` 才回到 `idle`。
  - `playIn`/`playOut` 直接覆盖 `_resolve`：在上一次过渡尚未结束时再触发一次，
    前一个 Promise **永远不会 settle**，`await` 就此挂死。现在开始新过渡前先结算旧的。
  - `circle-wipe` 的洞是 `maxR * p`，**随覆盖度一起变大**：p=1 时整块画布被擦掉，
    本该全黑的时刻反而全透明。改为 `maxR * (1 - p)`。
  - `duration: 0` 时 `elapsed / duration` 是 `0 / 0 = NaN`，`NaN >= 1` 为假，
    过渡永久挂起且 `progress` 报 NaN；负 duration 同理。现在非正数按「瞬时完成」处理，
    `raw` 双端钳到 [0, 1]（时钟回拨也不会把进度推成负数）。
  类注释里的 `await transition.play('fade', 400)` 是双重错误——`play()` 这个方法不存在，
  第二个参数也是 options 而非毫秒数，照抄必定 TypeError。已改为真实用法。
- `HudLayer` 的绘制与注册面（语句 49%）暴露三处缺陷，都在「重进场景时重建 HUD」这条
  ARPG 每关都会走的路径上：
  - `_add()` 对 `_map` 是 `set`、对 `_elements` 是 `push`。**同 id 重复添加不会替换**，
    旧元素永远留在绘制列表里（每关叠一层），而 `get()` 只能拿到最新那个。现在按原位
    替换，绘制顺序保持不变。
  - `remove()` / `clear()` 不清 `_pressedOn`：手指按住技能键时该键被移除，抬手仍会
    触发一次 `onClick`——一个已经不属于 HUD 的按钮。现在移除即遗忘按压状态。
  - `handleMove()` 跳过不可见按钮，于是隐藏时的高亮状态被保留，再显示回来就是亮的。
  另外补了 `elements` 只读访问器（对齐 `Scene.allObjects`），以及 18 个用例覆盖
  bar 的背景/填充/边框/标签、label 阴影、按钮 hover 配色、DPR 变换与 save/restore 平衡。
- `DebugRenderer` 是 `src/core` 里最后一个 0% 覆盖的大文件（181 条语句），而它恰好是
  调 ARPG 数值时最常开的工具，所以「画错」比「不画」更糟：
  - 光照圈半径写成 `(light.radius ?? 200) / (tileW / 2) * (tileW / 2)`——**除完再乘回去，
    是个伪装成单位换算的恒等式**，随后又乘 0.18。`OmniLight.radius` 本来就是屏幕像素，
    于是 320px 的光被画成 58px 的圈，正好在你要看光照范围的时候骗人。现在按原值绘制。
  - 触发区椭圆用 `r * tileW / 2` 和它的一半：既假定了 2:1 瓦片，又整体差了 √2。
    投影矩阵 `[[tw/2, -tw/2], [th/2, th/2]]` 的奇异值是 `tw/√2` 与 `th/√2`，
    世界圆半径 r 对应的正是这两个半轴乘 r，现在按精确值画。
  - 三处通过 `as unknown as { objects }` 强转读 `Scene` 的**私有字段**，其中一处的注释
    还写着「Access objects via the public getAll」——注释与代码互相打脸。改用 `allObjects`。
  - FPS 采样的 `_lastTs > 0` 是第九处哨兵，且重复时间戳会算出 `1000 / 0 = Infinity`，
    一旦进入滑动平均就永远污染，面板上直接显示 `FPS: Infinity`；时间戳回退则记负值。
    现在 `null` 哨兵 + 只在 `dt > 0` 时采样。
  类注释的示例同样不可用：`new DebugRenderer(scene, engine)` 少了 originX/originY
  （engine 被当成 originX），`input.onAction` / `input.bindKey` 这两个方法在 `InputMap`
  上根本不存在（应为 `define` + `on`）。已全部改成真实 API。
- `webgl-next` 的两个 overlay（`DomOverlayRenderer` / `MinimapRenderer`，都是 0% 覆盖）
  是 WebGL2 路径上唯一的文字与小地图出口，而用户选定的 ARPG 渲染器正是 WebGL2：
  - 文字 span 只靠预览页 CSS 里的 `pointer-events: none` 才不吃事件，但渲染器接受
    任意 root。挂到自己的容器上就会得到**一堆吞掉点击的伤害数字**——触屏 ARPG 里
    等于战斗中随机失灵。现在在代码里显式设置 `pointerEvents = 'none'`。
  - `MinimapRenderer` 直接读 `window.devicePixelRatio`，无 `window` 的环境下直接抛
    `ReferenceError`；画布尚未布局（rect 0×0）时会建出 1×1 的 backing store 并照常
    发一整帧谁也看不见的绘制指令。现在 DPR 有回退、零尺寸直接跳过。
- ARPG 需要存档（关卡进度、波次状态），于是撞上 `SceneSerializer` 这半边的封闭派发：
  `Engine.registerProp()` 一直允许应用**加载**自己的对象类型，但 `toJSON()` 是一条
  `instanceof` 链，自定义对象在**保存时被静默丢弃**——用 `scene.toJSON()` 写的存档
  读回来会少掉每一个怪物、刷怪点和传送门，而且没有任何报错。这正是当初 `SceneExtractor`
  注册表在渲染侧解决的同一个缺陷的**存档侧另一半**（「孪生类各有一份」第三次出现）。
  现在 `SceneSerializer.register(Ctor, serializer)`：serializer 只需返回 `{ type }`
  加自己的字段，`id` / `x` / `y` 由对象补齐（可被覆盖），`health` 由 `Engine` 侧还原成
  `HealthComponent`；返回 `null` 表示故意跳过。后注册者优先（子类可覆盖基类），内置类型
  仍先匹配。保存路径上跑的是应用代码，所以包了两道保护：serializer 抛异常只损失该对象，
  返回的条目缺 `type`（读不回来）则丢弃并告警；完全没有 serializer 的类型按构造函数名
  只告警一次——与 `Engine` 加载时对未知 prop type 的告警对称。
  `FloatingText` / `ParticleSystem` 是设计上的运行时对象，明确排除在告警之外。
  灯光侧是同一个缺陷的第二份：`toJSON` 只写 `OmniLight` / `DirectionalLight`，
  用 `Engine.registerLight()` 加载的自定义灯（BOSS 光环之类）同样保存时消失。
  `SceneSerializer.registerLight()` 补齐，并利用 `BaseLight` 已有的 `type` 字段
  （恰好就是 `Engine.registerLight()` 的 key）做默认值，所以 serializer 通常只写额外字段。
  写这条测试时抓到自己的一个设计陷阱：最初只默认填 `type` / `id` / `enabled`，
  于是往返回来的灯是白色的——`color` / `intensity` 明明是 `BaseLight` 的公共字段，
  却要每个 serializer 作者自己记得写。现在这两项也按内置分支的写法一并默认输出。
- `webgl-next` 至此才有 UI 通路。此前 `HudLayer` 是纯 Canvas2D，WebGL 预览页把标签手写成
  DOM，于是**在 WebGL2 后端上做游戏必须先自己实现一套控件**才能显示血条——这是用户选定的
  ARPG 渲染器上最后一个结构性缺口。做法是不把 HUD 移植到着色器，而是 `HudOverlayRenderer`
  把已有（且已被两个测试文件覆盖）的 `HudLayer` 挂在 GL canvas 之上的一张透明 2D canvas 上：
  控件、按压仲裁、DPR 契约全部复用，不产生第二套需要同步的实现。
  其中三处细节是从这一轮之前踩过的坑里直接搬来的：叠加 canvas 强制 `pointer-events: none`
  （否则它会吞掉所有触摸，游戏 canvas 一个事件都收不到——`DomOverlayRenderer` 的教训）；
  画布未布局（0×0）直接跳过而不是造一张 1×1 的 backing store（`MinimapRenderer` 的教训）；
  `hud.pixelRatio` 传的是**取值函数**而非数值，因为窗口在不同缩放的显示器之间移动时比率会变
  （`HudLayer` 那次 DPR 回归的教训）。清屏在设备像素下做，之后由 `HudLayer.draw` 装自己的
  变换，避免漏掉右下边缘。
  刻意**没有**接进预览页：三张像素基线刚刚生效，往夹具里加 HUD 会立刻让门禁变红。
- 手写关卡文件（ARPG 的波次配置就是这种东西）会走 `validateSceneJson`，而它有一个更根本
  的问题：**引擎里没有任何地方调用它**。`buildScene()` 拿到什么就装什么，未知 type 只在
  加载时 `console.warn`。这不算缺陷（校验器本来更适合编辑器/流水线/CI），但文档从没说清，
  所以先写明白。随后补了五处：
  - 内置集合之外的 type 一律报 error，可校验器**根本无从知道**应用通过
    `Engine.registerProp()` 注册了什么——注册了 `mob` 的 ARPG 关卡直接被判"无效"。
    文件里那句关于 `tree` / `flowers` / `lantern` 曾经漏登记的注释，说明这个坑已经踩过一次。
    现在未声明时降级为 warning；一旦调用方传了 `propTypes` / `lightTypes`（等于声明了全集），
    未知 type 才升级为 error。**这是对外语义的变更**，原有那条测试相应改写。
  - `lights[i]` 只校验了 omni 的 x/y/z，**directional 的 `angle` / `elevation` 完全没查**，
    写成字符串也能通过校验，然后在运行时变成 NaN 变换。
  - 全场景 id 重复检测（floor / walls / characters / props / lights 一起查）。
    `Scene.removeById` 会过滤掉**所有**同名对象、`getById` 只返回第一个，所以重复 id 意味着
    一个对象取不到、两个一起消失——手写波次文件最容易犯的错。
  - `props[i].health` 会被 `Engine` 直接塞进 `new HealthComponent({ max })`，字符串或 0
    造出的是「一出生就死」的对象；现在要求存在时必须是正数。
  - 零长墙的 warning 原本在坐标缺失时也会触发（`undefined === undefined`），
    于是四条坐标 error 之上再叠一条无意义的警告；现在仅在坐标确为数字时判断。
- `webgl-baselines` 工作流曾连续几个提交无法被 dispatch，根因是一行不合法的 YAML
  （`- run: echo "Reason: ${{ inputs.reason }}"`——纯量里不能出现 `: `）。真正的问题不是
  那一行，而是**仓库里没有任何东西检查工作流语法**：GitHub 只把它写成某次 run 上的
  annotation，既不构成失败的 check，本地也复现不出来，所以修好之后旧 annotation 还留在
  历史里，看起来像「还在报错」。现在补上 `scripts/lint-workflows.mjs`（零依赖，不引入
  YAML 解析器）与 `npm run lint:workflows`，三条规则都是这里真实踩过的：
  未加引号却含冒号的纯量、缩进里的 Tab、把 `${{ inputs.* }}` / `${{ github.event.* }}`
  直接插进 `run:`（shell 注入，应走 `env:`）。`webgl-preview.yml` 的 paths 从只监听
  自身扩到 `.github/workflows/**`，并在 `npm ci` 之后跑这道门禁——工作流语法错误从此
  是一次失败的 CI，而不是一条没人看见的 annotation。14 个用例覆盖规则本身，其中一个
  直接断言仓库现有工作流全部通过。
- 把 ARPG 从"审计镜头"变成真正跑起来的一局（`examples/10-arpg`），暴露的问题和补测
  暴露的不是一类——都是**集成缝**，单模块测试永远碰不到：
  - `examples/09-slopes` 从落地起就在 `examples/index.html` 里有链接，却从来没被登记进
    `vite.config.ts` 的多页 `input`。`npm run dev` 从磁盘解析文件，所以本地一切正常；
    只有部署出去的站点上那个链接是 404。这类"只在构建产物里存在"的缺陷没有任何测试会
    发现，**新增示例页必须同时改 `vite.config.ts` 和 gallery**。
  - `HudLayer` 有 label / bar / button / panel，却没有"自己会画"的控件类型，而
    `TouchStick` 正是这种。WebGL2 路径上唯一的 2D 画布归 `HudOverlayRenderer` 所有，
    于是游戏想画摇杆只能绕到它背后 `getContext('2d')` 并自行重推 DPR 变换——正好是
    上一轮刚修掉的那类错误的温床。现在 `HudOverlayOptions.paint` 在 HUD 之后、
    save/restore 之内、装好 backing-store 变换的前提下回调，逻辑像素与 HUD 一致。
  - 一局的结构（三波 → Boss → 结算）写成不碰 Scene / Engine / DOM 的 `WaveDirector`，
    18 个纯单测就能跑完整局。它自己的第一版也踩了这轮反复出现的时间坑：把中场休息的
    溢出时间递归喂回 `update(overshoot)`，导致同一帧的时间被计了两次（一帧 5 秒跨过
    2 秒中场，`elapsed` 报 8 秒）。**溢出只该用来结束倒计时，不该再次累加。**
  - 自定义 `Entity` 想在 GL 路径上出现，必须走 `SceneExtractor.register`；不注册就是
    洋红诊断菱形。测试同时钉住注册前后两种结果，避免以后有人"顺手"把注册表去掉。
- 把一局的规则从 `main.ts` 抽成 `ArenaRun`（`step(dt, intent)` 驱动，不碰 renderer /
  canvas / input），于是"这一局真的能打完"第一次成为可断言的事实，而不是"在浏览器里
  看着像能打完"。11 个用例覆盖胜、负、重开、生成/销毁记账。抽的过程中又暴露两处：
  - **示范玩法根本赢不了**：一个只会原地挥击的英雄，三波加 Boss 要吃约 330 点伤害，
    而血量池是固定的 120——要么必死，要么把血量堆到"一切都不构成威胁"。补上 ARPG 的
    标准答案「击杀回血」（`LIFE_ON_KILL`）之后，节奏才成立：只要持续击杀就能续命。
    这类问题只有把整局跑完才会浮出来，靠模块测试永远碰不到。
  - Boss 的攻击距离（1.3）比英雄（1.15）远，原地挥空的英雄会被卡在打不到的位置上
    活活磨死。这是有意的压迫感，所以写成一条断言钉住：**要赢必须拉近距离**，
    另一条断言则钉住"只挥不走"必然止步于 Boss。
  - `ArenaRun` 最初在构造函数里就 `start()`，于是 `onSpawn` / `onPhase` 会在调用方的
    `const run = new ArenaRun(...)` 绑定完成之前触发——回调里读 `run` 直接 TDZ 抛错。
    现在 `start()` 独立成一步，与 `WaveDirector` 一致：**构造只建状态，不发事件。**
- 顺着"存档/读档一局"往下摸，在 `Engine._buildScene` 的 props 分支上抓到两处真缺陷，
  两处都只有自定义 prop（也就是注册表存在的理由）才会踩到：
  - `if (p.health) (prop as any).addComponent(new HealthComponent(...))` 是**无条件注入**。
    `Entity.addComponent` 会 detach 并替换同类型组件，于是一个自己创建并缓存了
    `HealthComponent` 的类（这正是常见写法，`Combatant` / `Boulder` 都是）加载后
    出现分裂：类内部持有的是已被 detach 的实例，Systems 看到的是引擎注入的另一个，
    `onDeath` 回调也一起丢掉。现在已有组件就保留，只用 JSON 的值 `setMax()`——
    这也让"存档里半血的怪读回来还是半血"成立。
  - 同一行的 `as any` 对**非 Entity 的 prop** 会直接 TypeError，一个坏条目就能让整张
    场景加载中断。现在先探测 `addComponent` / `getComponent` 再动手，并把
    `health` 的非正数/非数值也降级为一条警告（与 `Validator` 对 `props[i].health`
    的要求一致），而不是把 NaN 塞进组件。
  - 顺着同一条路还发现**存档根本不保存当前血量**：`SceneSerializer` 只写 `health`
    （上限），于是一次 checkpoint 把全场治满——留在 3/50 的巨石读回来是 50/50。
    现在受伤时才额外写 `hp`（未受伤的场景文件形状不变），加载时走新增的
    `HealthComponent.restore()`：不发 damage / heal / death 通知，所以"存档时已经
    死了的单位"读回来仍是死的，而不会把 `onDeath` 在加载中途再跑一遍。
- 把 checkpoint 真正做完（K 存 / L 读，落在 localStorage），暴露的是**边界形状**问题：
  - 一局的进度此前只活在内存里。`WaveDirector` 加了 `snapshot()` / `restore()`：只有
    phase / wave / alive / kills / elapsed / countdown 这些账面数据，怪的身份属于场景、
    由场景自己的序列化负责。`restore()` 刻意**不触发**生成回调（单位是跟着存档一起
    读回来的，再生成一遍就是双份），但会在 phase 真的变化时触发 `onPhase`，让 UI 跟上；
    非法字段（未知 phase、NaN、超界）一律保留当前值，手改过的存档只会退化不会投毒。
  - `Engine` 原先只能构建**整个** `Scene`，没有"把一段 props 装进现有场景"的入口，
    于是读档只能先建一个丢弃用的场景、把 `getAll(Combatant)` 抬出来。这已经补上了：
    新增 `Engine.buildProps(entries)`（静态，只建对象不建场景），`buildScene` 自己
    也改走这条路，两条路径不会再分叉。示例的读档随之简化成
    `Engine.buildProps(save.scene.props)` 交给 `ArenaRun.adopt()`（旧单位走
    `onDespawn`、新单位走 `onSpawn`，调用方的场景自然跟随）。
  - 另一处形状：`ArenaRun` 的构造函数会先生成一个英雄，于是 `adopt()` 之前总有一个
    占位英雄被立刻销毁。对页面无害（'ready' 阶段场上确实该有人），测试里已经把这个
    事实写清楚，避免以后被当成泄漏。
- `MovementComponent` 只和**瓦片**碰撞，不和其他单位碰撞，于是一波小怪会收敛成一摞：
  四只怪叠在同一格上，后三只完全被第一只挡住。这不是 bug，而是框架没有动态体的概念。
  按"先在示例里验手感、值得再上升"的顺序，`ArenaRun._separate()` 先落在示例里：
  每帧把重叠的一对各推开一半重叠量，推的位移仍然过 `nudge`（因此会被扫掠碰撞挡住，
  不会把谁推进墙里），死者不参与，完全重合时按下标奇偶选一个确定方向而不是随机。
  规模是个位数，所以 O(n²) 是有意的选择——**框架级版本需要空间分桶，那是另一个决定**，
  不该由一个示例替引擎定下来。4 个用例钉住：叠堆会散开、收敛的一波不会重叠、
  死者留在原地、任何推挤都不能把单位送进墙里。























## 当前评价

| 维度 | 评分 | 说明 |
|---|:---:|---|
| 模块分层 | 9/10 | Scene 渲染与序列化职责已拆分 |
| ECS 设计 | 8/10 | 构造函数查询、System、生命周期完整；尚无 archetype |
| 渲染管线 | 8/10 | Canvas 完整；WebGL 预览已覆盖核心 pass，尚待 golden 和浏览器矩阵 |
| 类型安全 | 9/10 | ComponentCtor 与 EventMap 覆盖核心扩展面；`tsc` 现已覆盖 examples 与 e2e |
| 可扩展性 | 9/10 | 加载注册表、自定义事件、WebGL extractor 注册表均已就绪；序列化注册表待补 |
| 文档质量 | 8/10 | README 与本报告已同步当前实现 |
| 测试覆盖 | 8/10 | 905 个单测 + 11 个浏览器测试；已接入 v8 覆盖率与分模块阈值（整体 77.3% 语句 / 75.2% 分支），三个 fixture 已按 1.5% 门槛比对基线 |
| 综合 | 8.3/10 | 架构短板已大幅收敛，下一阶段应由 profiling 驱动 |

测试数量不等于覆盖率。`vitest.config.ts` 现已按模块设定阈值（math/physics/lighting
90% 语句、ecs 86%、animation 88%、audio 78%、core 76%、elements 57%，整体 69.3%），
并在 CI 中作为门禁。阈值一律设在当前值略下方，只能随新测试上调，不允许为了让构建
通过而下调。

补测的实际收益是找 bug，而不是把百分比推高：`AudioManager`（0%→68%）、`ObjectPool`
（0%→100%）、`InputMap`（0%→98%）、`AssetLoader`（20%→98%）、`DirectionalAnimator`
（0%→99%）、`ParticleSystem`（47%→85%）、`ClickMover`（0%→100%）这七轮，每一轮都在
原本无人覆盖的分支里发现了缺陷。规律已经很稳定：**文档写得越完整、测试却是零的
模块，实现几乎必然已经和文档分叉**——上面七个模块的 README 段落都写得像已经验证过。
