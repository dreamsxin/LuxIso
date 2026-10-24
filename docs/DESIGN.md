# LuxIso 框架设计

> 版本：v1（2026-10-17）
> 本文是框架的**设计基准**：它解释系统为什么是现在这个形状、跨子系统必须共同遵守的契约，以及下一步设计改进的优先级。
> 配套文档：
> - [REFERENCES.md](./REFERENCES.md) — 外部设计资料汇编（每条链接均经验证，附对本框架的启示）
> - [../FRAMEWORK_ANALYSIS.md](../FRAMEWORK_ANALYSIS.md) — 历次审计与缺陷修复日志（本文的决策从这里提炼）
> - [../README.md](../README.md) — 用户视角的 API 与用法
> - [../webgl-next/ARCHITECTURE.md](../webgl-next/ARCHITECTURE.md) — WebGL2 后端的边界与渲染图
>
> 当代码与本文冲突时：先判断是代码缺陷还是文档过时，任何一边都不自动获胜；改动必须让两者重新一致。

---

## 目录

1. [设计目标与非目标](#1-设计目标与非目标)
2. [分层架构与依赖规则](#2-分层架构与依赖规则)
3. [一帧的生命周期](#3-一帧的生命周期)
4. [核心契约](#4-核心契约)
5. [子系统设计](#5-子系统设计)
6. [扩展模型：四个注册面](#6-扩展模型四个注册面)
7. [框架级设计原则](#7-框架级设计原则)
8. [差距分析与改进提案](#8-差距分析与改进提案)
9. [决策记录（ADR 摘要）](#9-决策记录adr-摘要)
10. [术语表](#10-术语表)

---

## 1. 设计目标与非目标

### 1.1 目标

| 目标 | 含义 | 主要证据 |
|---|---|---|
| **浏览器内 2.5D 等距游戏内核** | 瓦片方格世界 + 菱形投影 + 高度排序；Canvas2D 即可完成完整游戏 | `math/IsoProjection`、`math/depthSort`、example 01–10 |
| **模拟与渲染分离** | 玩法状态不依赖任何绘图上下文；同一状态可被 Canvas2D 与 WebGL2 渲染 | `RenderSnapshot` 唯一桥；`ArenaRun.step(dt, intent)` 不碰 DOM |
| **帧率无关的手感** | 60/120/144Hz、后台切回、断点恢复后行为一致 | 固定步长累加器 + `FrameClock` 单点契约 |
| **移动端可用** | 多点触控、DPR 适配、手势解锁音频、不抢浏览器手势 | 触点表、TouchStick、`maxPixelRatio=2`、`bindPageLifecycle` |
| **可扩展而不改源码** | 自定义道具、灯光、渲染、存档类型均经注册表接入 | 四个注册面（见 §6） |
| **无头可测** | 整局游戏、物理、时序都是不建 canvas 的纯逻辑断言 | 87 个测试文件、约 1130 个单测；契约用例表 |
| **每个版本可发布** | 任何重构阶段 `main` 都能出包；Canvas2D 永远是回退路径 | WebGL ROADMAP「每阶段留回退点」 |

### 1.2 非目标（明确不做，防止设计漂移）

- **通用 3D 引擎**。几何始终是「2D 方格 + 屏幕像素高度」，不引入场景图/矩阵层级。
- **与规模不符的 ECS 机械**。当前规模（千级实体、JS）不追求 SoA/archetype 列式存储——Excalibur 明确声明「缓存友好布局不是目标」的判断在此同样成立（[REFERENCES §13](./REFERENCES.md#13-jsts-引擎横向调研)）。先上查询缓存（G3），archetype 留到数据说话之后。
- **自研刚体物理**。碰撞模型是瓦片网格 + sweep；动态体之间的互动由玩法层/未来的引擎级分离服务承担，不引入冲量求解器。
- **联机与回放**。但所有时序设计为其预留：固定步长、意图注入、确定性友好（未来需要播种 RNG，见 G12）。
- **WebGPU 后端**。在 WebGL2 预览的快照契约被两次迭代证明之前不启动（webgl-next ROADMAP Phase 7）。

---

## 2. 分层架构与依赖规则

```text
┌──────────────────────────────────────────────────────────────┐
│ 应用层（examples / 游戏代码，不进 lib 包）                      │
│   main.ts · SceneManager 工厂 · WaveDirector · ArenaRun       │
├──────────────────────────────────────────────────────────────┤
│ 框架公共 API（src/index.ts barrel）                            │
├──────────────┬───────────────┬───────────────┬───────────────┤
│  core/       │  ecs/         │  elements/     │ animation/    │
│  Engine 循环 │  Entity       │  IsoObject     │ audio/        │
│  Scene 容器  │  Component    │  Floor/Wall    │ physics/      │
│  场景管理     │  System       │  Character/props│ time/        │
│  输入/HUD     │  EventBus     │  lighting/     │ math/         │
├──────────────┴───────────────┴───────────────┴───────────────┤
│ 渲染后端（实现 RenderBackend；模拟层不知道其存在）               │
│   Canvas2D: SceneRenderer（库默认）                            │
│   WebGL2:   webgl-next（SceneExtractor → RenderSnapshot → GL）│
├──────────────────────────────────────────────────────────────┤
│ 平台：DOM / Canvas2D / WebGL2 / Web Audio（经最浅封装访问）      │
└──────────────────────────────────────────────────────────────┘

editor/    开发工具，lib 构建明确排除
webgl-next/ 独立预览包，契约成熟后才允许并入 src/render/
```

### 2.1 依赖方向（规则，不是建议）

1. **依赖只能向下**。`core` 协调各基础模块；`elements/ecs/physics/...` 互不横向依赖（组件不 import Scene，只接受挂载回调）。
2. **模拟永远不 import 渲染后端**。Scene/ECS 代码里出现 `CanvasRenderingContext2D` 即违规；反向（渲染读模拟）合法。
3. **`RenderSnapshot` 是模拟→渲染的唯一桥**。渲染器对象不成为存档、不成为玩法事实；纹理 URL 是抽取记录，不是实体上的 GPU 句柄。
4. **输入先变成动作再改状态**。DOM 事件 → `InputManager` 原始状态 → `InputMap` 动作/轴 → 玩法意图。玩法代码不读键码。
5. **类型引用不构成运行时环**。`SceneRenderer`/`SceneSerializer` 以 `type` 引用 Scene。
6. **`time/FrameClock` 是叶子层**。任何模块都可以依赖它，它不依赖任何模块。

### 2.2 模块职责一句话表

| 模块 | 拥有 | 明确不拥有 |
|---|---|---|
| `Engine` | canvas、rAF 链、固定步累加器、JSON 构建、类型注册表 | 玩法状态、绘制决策 |
| `Scene` | 对象/灯光/System 容器、生命周期、相机、IsoView 过渡 | 光栅化（委托 SceneRenderer）、JSON 格式（委托 Serializer） |
| `SceneManager` | 命名场景**栈**、enter/exit/pause/resume、失败回滚 | 场景内部对象 |
| `System` | 对匹配实体集合的批处理与帧序 | 实体存储（在 Scene） |
| `Entity`/`Component` | 组件 Map 与挂载生命周期 | 彼此的查询顺序 |
| `FrameClock` | dt 推导契约（四条规则） | 业务语义 |
| `TileCollider`/`Pathfinder` | 可行走网格、sweep、A*+LoS+缓存 | 动态体 |
| `RenderSnapshot` | 一帧的渲染器中立数值记录 | 任何状态修改权 |
| `GLResourceRegistry`/`TextureRegistry` | GPU 句柄与懒加载纹理的生死 | 模拟状态 |
| `InputManager`/`InputMap` | 原始设备状态 / 动作绑定与轴合成 | 玩法响应 |
| `AudioManager` | 单一 AudioContext、三总线、buffer/panner 生命周期 | 该放哪种音效（玩法决策） |

---

## 3. 一帧的生命周期

`Engine._tick(ts)` 是全框架唯一的时间源分配点（[src/core/Engine.ts:681](../src/core/Engine.ts)）：

```text
rAF 回调 ts（同一帧内所有 rAF 共享一个 DOMHighResTimeStamp）
  │
  ├─ dt = FrameClock.sample(ts)         // [0, 0.1]s；首帧 0；倒流 0；非有限 0
  ├─ accumulator += dt
  │   while (acc >= fixedDeltaTime)     // 实际步数已被 dt 钳制间接封顶（约 7 步），
  │     Scene.fixedUpdate(1/60)         // 但没有显式常量/计数，见 G1
  │       ├─ 刷新 System 匹配
  │       ├─ systems[i].fixedUpdate(matches, dt)   // priority 升序
  │       └─ Entity.fixedUpdate(dt) → 各组件 fixedUpdate
  │     acc -= 1/60
  │
  ├─ Scene.update(ts)                   // 可变帧率域
  │     ├─ IsoView 过渡（easeInOutCubic，按 dt）
  │     ├─ Camera.update(dt)            // 帧率无关 lerp：1-(1-f)^(dt·60)
  │     ├─ 刷新 System 匹配
  │     ├─ systems[i].update(matches, dt)          // 先于逐对象更新
  │     ├─ object.update(ts, collider)             // 仅 visible；Entity 内驱动组件
  │     └─ 清扫过期 FloatingText
  │
  ├─ clearRect（逻辑像素）
  ├─ preFrame 回调（背景/天空）
  ├─ Scene.draw
  │     Canvas2D: SceneRenderer：剔除 → topoSort → lightmap/阴影 → 逐个绘制
  │     WebGL2:  SceneExtractor 产出 RenderSnapshot → WebGLRenderer 各 pass
  └─ postFrame 回调（HUD、点击标记、Debug）
```

**帧序是公开契约。** System 先于逐对象更新，意味着 System 看到的是组件本帧之前的状态；同 priority 的 System 按注册序执行（与 Godot `process_priority` 的平局规则一致）。任何对帧序的依赖必须能在本文档中指出，而不是藏在数组顺序里。

**输入边沿在帧边界结算**：`InputManager` 的 pressed/released 边沿由消费者每帧 `flush()`，保证一个边沿恰好被消费一次，跨场景切换时不残留按住状态。

**页面隐藏不是慢帧，是暂停**：hidden → 取消 rAF；visible → 时钟 `reset()`、累加器清零、重排链。空档被显式丢弃而非钳成 100ms 积分。

---

## 4. 核心契约

契约是跨子系统的不变量。它们大多来自真实缺陷（括号内是出处轮次），新增同类代码必须遵守；已有共享测试表的由 CI 强制。

### 4.1 帧时间契约（FrameClock）

任何**从时间戳自行推导 dt** 的模块都必须使用 `FrameClock` 或登记进 `FrameDeltaContract.test.ts`。四条规则，每条都被生产代码违反过：

1. 时间戳 `0` 是普通的第一帧；首帧哨兵只能是 `null`（同一缺陷出现过 12 次）。
2. 时间倒流产生 0，绝不产生负 dt。
3. 长间隔（隐藏标签、断点）钳制而非积分：运动类上限 100ms，时间线类 500ms。
4. 非有限时间戳返回 0 **且不更新基线**（否则后续每一帧永远是 NaN）。

暂停/重启 = `clock.reset()`（语义：下一帧重新算首帧），不是「把时间戳设为 0」。
平滑/追赶一律用帧率无关式：`1 - (1 - f)^(dt*60)`。
例外是被显式记录的：`DebugRenderer` 的 FPS 表需要未钳制的毫秒差，有意不迁。

### 4.2 坐标与单位契约

- 世界平面：X/Y 为瓦片单位；投影只有相机/视图能做缩放，对象自身不做。
- **Z 只有一个单位：屏幕像素**。`position.z`、AABB 的 `baseZ/maxZ`、`projectIso` 共用，抽取层无换算（旧的双 Z 单位与 `Z_UNITS_PER_PX` 已删除，ADR-003）。
- **游戏接触的一切都是逻辑（CSS）像素**：backing store = 逻辑 × `pixelRatio`（自动 DPR，钳在 `maxPixelRatio=2`）；输入坐标、HUD 命中框、Scene.draw 尺寸全部逻辑像素。
- 等距视图 `IsoView = {rotation, elevation}` 是场景级状态；任何世界↔屏幕 helper 必须接收同一个 view——漏传 view 曾让旋转场景的拾取、调试绘制、编辑器放置全部错位。
- `zoom` 等公开可写数值字段由内部消费点做除零/NaN 守卫，不假设调用方守规矩。

### 4.3 模拟/渲染分离契约

- 模拟拥有：实体、组件、计时器、血量、碰撞、寻路、进度、一切可序列化值。
- 渲染拥有：GPU 资源、pass、动画呈现、相机矩阵、picking buffer、诊断。
- 桥只有 `RenderSnapshot`（frame、tileW/H、camera、environment、geometry arena、灯光、overlay、pickLookup、unsupported）。
- Scene JSON 渲染器中立；切换后端不改任何玩法状态。
- 后端故障不越过边界：context loss 停止提交但不停止模拟；恢复在 2 秒内从快照重建全部资源，模拟无感知。
- 应用自定义 extractor 跑在渲染路径上，**两道保护**：异常或零产出 → 退回诊断菱形并记入 `unsupported`；一个坏对象不带崩整帧。

### 4.4 输入契约

- 三层：设备原始状态（`InputManager`，轮询模型，与 Gamepad API 一致）→ 动作绑定（`InputMap`，语义名稳定、可 toJSON 改键）→ 意图（玩法层，如 ArenaRun intent，可被 AI/测试注入）。
- 动作可由多源同时满足；`axis()` 把所有 active 源相加后长度截到 1：纯键盘行为逐位不变（单键 1、对角 1/√2），键盘+摇杆不获得额外速度。消费方不得再归一化（ClickMover 曾把 40% 推杆放大成满速）。
- 模拟量死区在语义层（与 Godot per-action deadzone 一致）：越过死区后重新缩放到 0 起步。
- 多点触控按 `changedTouches`/identifier 维护完整触点表；`pointer` 只随主触点，主触点抬起提升最老存活触点；鼠标三键各自独立，`pointer.down` 只在**全部**鼠标键松开时清。
- 切窗/失焦全量释放；默认对 canvas 触摸 `preventDefault`。

### 4.5 所有权与生命周期契约

- 每个资源有唯一属主，且有与获取对称的释放：`dispose()` 摘监听、清状态、断闭包；音频节点在 `onended`/淡出终点拆链；纹理只经 `GLResourceRegistry.releaseTexture()` 删除（否则计数不归零，而 lifecycle e2e 断言归零）。
- 加载中的纹理**不可淘汰**（淘汰会让 image 回调写进无人跟踪的记录——泄漏的正是防护本身）。
- 纹理淘汰按帧引用计数，连续 120 帧（60Hz 两秒）未引用才删：走回应付重新加载，切场景应回收。
- 场景栈操作是**事务**：`replace` 先建后退，新场景 `onEnter` 失败回滚旧栈；`pop` 的装载与恢复在 `finally` 中；`push` 回滚含已建场景的 `assetLoader.clear()`。释放永远晚于新场景成功存活。
- `System` 单场景归属，跨场景 attach 抛错；attach 失败不留半挂载状态。
- 场景卸载是监听器/回调的确定性死亡点：历史上 InputManager.destroy 不清闭包、SceneManager 异常留下 paused 场景，都是违反此契约。

### 4.6 序列化契约

- 存档是**构造恢复**，不是状态回放：读出 → 工厂构造 → 赋值；`HealthComponent.restore()` 不发 damage/heal/death（存档时已死的单位读回来仍是死的，不会在加载途中演一遍死亡）。
- 只有显式登记的参与者进入存档（与 Godot「Persist group」同构）；运行时对象（FloatingText、ParticleSystem）设计上排除。
- 未知类型策略对称：加载侧无工厂 → 跳过+每类型告警一次；保存侧无 serializer → 按构造名告警一次；校验器在未声明全集时未知 type 降为 warning，调用方传了 `propTypes/lightTypes` 全集才升为 error。
- 内置字段默认补齐，serializer 只写额外字段（`id/x/y` 由框架补；灯光的 `color/intensity/enabled` 也补——曾出现「每作者必须记得写颜色，否则灯是白的」的陷阱）。
- 存档是不可信输入：编辑器面板插值转义；维度非法立即抛错而非退化成全阻挡网格；`health/hp` 非法数值降级为警告。
- 当前缺口：根记录无 schema 版本字段、无规范化字节编码（G9）。

### 4.7 事件契约

- 事件名与 payload 由同一个 `EventMap` 约束；默认开放字符串总线，`globalBus` 使用内置 `LuxIsoEventMap`；组件只依赖 `Pick<>` 出的所需事件，允许应用扩展事件集。
- 事件是**过去的事实广播**，不是命令；需要返回值/单接收者的通信不要走总线。
- payload 携带值快照，不携带「稍后处理时可能已经移动/删除」的活对象引用（Nystrom Event Queue 的过期世界规则）。
- 当前缺口：总线订阅不随实体/场景死亡自动摘除、无帧内排空策略、无订阅句柄（G6）。

### 4.8 可测试性契约

- **规则不碰 DOM**：任何一整局可玩的逻辑必须存在 `step(dt, intent)` 形态的纯驱动入口（ArenaRun/WaveDirector 是范本），「这一局真的能打完」是单测断言而非浏览器印象。
- **跨模块契约用共享用例表**：契约一处定义，所有消费者登记（FrameDeltaContract）。模块测试无法为还不存在的模块失败。
- **阈值是棘轮**：覆盖率地板与像素预算只准收紧；设在当前已知良好值略上方。
- **浏览器只放浏览器才有的行为**：context loss、真实音频解码、DPR、生命周期；其余在毫秒级无头层断言。
- 像素门禁承认自己的盲区：整画布预算结构上保护不了单道具、golden 会把顺序缺陷固化为基线；这类不变量下沉到 `RenderSnapshot` 层做无阈值断言（道具轮廓、pick-id 提交顺序）。

---

## 5. 子系统设计

### 5.1 游戏循环（Engine）

rAF 驱动；固定步 1/60 消费累加器，可变帧消费 Scene.update；`_loopGeneration` 区分 rAF 链代数——`_rafId` 不能兼任「循环是否在跑」（回调体一开始就把它置空），过期链拒绝重排，这是双速链缺陷的修复关键。`start` 幂等守卫是 `_running`。`stop()` 同时重置时钟与累加器（stop 是暂停，文档承诺可重启）。

### 5.2 场景容器与 System 调度（Scene）

Scene 持有对象数组、灯光数组、System 数组（priority 稳定插入序）与每 System 的匹配数组。System 匹配要求实体具备 query 中**全部**组件构造函数；匹配数组每帧复用（length=0 回填）。渲染状态（lightmap、剔除缓冲、排序缓存、阴影缓存）全部在 SceneRenderer 并按失效信号（对象增删/灯光增删/视图变化）重建——Scene 自身保持在约 260 行的职责拆分即此。

深度排序：2D 空间桶限定候选 AABB 对 → 数字 pair key 去重 → min-heap Kahn 队列。稠密同桶退化 O(n²) 是已知最坏情况（G7）；静态场景复用排序缓存，缓存哈希含对象身份与 AABB。

### 5.3 ECS

采用「富实体 + 组件 Map + 批处理 System」的折中形态（介于经典 OOP 实体与纯 ECS 之间，与 PlayCanvas/Excalibur 的实用取向一致）：

- Entity 继承 IsoObject（有位置、aabb、draw），组件 Map 以**构造函数引用**为键（不是字符串）；同类型替换先 detach 旧组件。
- 组件有 onAttach/onDetach 生命周期；组件自更新（每实体）与 System 批处理（跨实体）两条路都保留： flock、批量 A*、集中回收死亡者用 System；单体行为用组件 update。
- 组件保持可序列化纯数据袋（存档简单性的根）。
- 已知规模边界：每帧 O(实体×系统) 重扫匹配，无 archetype、无结构版本缓存（G3）；实体 id 是裸字符串、无代次（G5）。

### 5.4 相机与视图

Camera 负责 follow/pan/zoom/旋转/elevation；`worldToScreen`/`screenToWorld` 与 `applyTransform` 必须是互逆且使用同一 view；lerp 帧率无关；zoom 钳制与除零守卫在相机内部。IsoView 过渡由 Scene 用 easeInOutCubic 驱动，期间每帧 invalidate lightmap。

### 5.5 碰撞与寻路

- `TileCollider`：可行走网格；`canOccupy`（脚印）、`resolveMove`（终点检测，保留贴墙滑行）、`sweepMove`（连续检测，位移大于脚印半径时启用——击退/冲刺穿墙的修复）；`version` 计数器供 PathCache 自动失效（开关门后不给旧路径）。
- `Pathfinder`：8 向 A* + min-heap；Bresenham LoS + string-pull 拉绳（拐角规则集中在此，禁止调用方私抄）；`PathCache` 每场景持有；`hasLineOfSight()` 公开供「看得见才直走」。
- 重定路径节流（0.35s）：移动目标每帧使旧路径失效，不节流就是每怪每帧一次 A*。
- 已知边界：**不与其他动态体碰撞**——单位会叠成一摞。ArenaRun 的 O(n²) 推开是示例层有意的小规模答案；引擎级版本需要空间分桶（G7），不由示例替引擎拍板。

### 5.6 渲染（两后端）

**Canvas2D（默认）**：SceneRenderer 剔除 → topoSort → Floor 离屏 lightmap 缓存（按脏快照）→ 解析阴影投影（ShadowCaster，AABB→z=0 轮廓，移动光/投影体每帧重算，静态按 对象×光 输入缓存）→ 不透明对象 → 透明/粒子/halo。

**WebGL2（预览）**：SceneExtractor 遍历排序后列表产出渲染器中立数值记录进一个交错 Float32Array arena，区间为 floor/shadow/opaque/transparent/debug；segment 在 blend 与纹理一致时延伸（无纹理百道具合并为一次绘制）；pass = floor → shadow mask（按 几何/相机/目标签名缓存的 GPU 掩码）→ 灯光累积 → composite → 透明/粒子 → ID picking（24-bit 稳定 ID，按需小 framebuffer，编辑器选择不依赖可见像素颜色）→ debug。HUD/文字/DOM 不进 GL：HudOverlayRenderer 把既有 HudLayer 挂到 GL canvas 上的透明 2D canvas，叠加层强制 `pointer-events: none`、零尺寸跳过、DPR 用取值函数。

**顺序约束**：topoSort 已固定绘制顺序，合批只允许在「Kahn 序相邻且彼此无深度冲突边」的段内进行——正交引擎的合批器不能照抄。图集使用 clamp-to-edge + UV padding 防溢出。

### 5.7 资源管线（现状与目标）

现状：贴图以 URL 经 TextureRegistry 懒加载；AssetLoader 是 Promise 图片缓存，场景级实例随 SceneManager 退出清理。目标包策略（webgl-next ARCHITECTURE）：manifest 声明颜色空间/预乘/过滤/wrap/mip 策略；可选 glTF 2.0 带一致枢轴与碰撞代理；运行时绝不直接加载原始创作资产。

### 5.8 输入与 HUD

见 §4.4。HudLayer 是屏幕空间保留模式控件（label/bar/button/panel）：命中测试覆盖所有有尺寸元素并返回最上层；帧驱动按压仲裁（同按钮抬起才触发、按 contact id 跟踪、与 TouchStick 不抢手指）；`minHitSize` 可对称扩到 44×44（移动端触控目标规范），默认 0 以保相邻按钮行为；resetTransform 必须重置到 pixelRatio 缩放而非单位矩阵。

### 5.9 音频

单 AudioContext；master/sfx/bgm 三增益总线；SFX 预解码、fire-and-forget、空间音走 PannerNode(HRTF)；BGM 交叉淡入淡出用**请求代号**防并发竞态（后到的请求获胜，旧 source 在淡出终点被 `_retireBgm` 拆链——循环 source 永不触发 onended，必须显式清理）；玩法层限流（每帧声部上限、同种 cue 最小间隔——同点四份同音是 4 倍振幅削顶，不是和弦）；`bindPageLifecycle()` 手势解锁 + 隐藏 suspend。

### 5.10 序列化与校验

见 §4.6。Scene JSON 含场景/相机/视图/灯光/Floor+walkable/Wall/Character/Cloud/props；`Engine.buildProps()` 提供「把一段 props 装进现有场景」的增量入口（checkpoint/流式房间），与 buildScene 同一路径不分叉。

### 5.11 编辑器

EditorState 是中央 store + 100 步撤销/重做命令栈；EditorRenderer 经 Engine 实时预览，场景重建按帧合并；editor 代码不进 lib 包；编辑器内插值一律转义（导入 JSON 是不可信输入）。

---

## 6. 扩展模型：四个注册面

开闭原则在本框架的具体形态是**注册表**，且四个面必须对称理解：

| 能力 | 注册 API | 方向 | 只登记一面的后果 |
|---|---|---|---|
| 加载自定义道具 | `Engine.registerProp(type, factory)` | JSON → 对象 | 存档读不回，静默跳过+告警 |
| 加载自定义灯光 | `Engine.registerLight(type, factory)` | JSON → 灯 | 同上 |
| 保存自定义对象/灯光 | `SceneSerializer.register(Ctor, ser)` / `registerLight` | 对象 → JSON | `toJSON()` **静默丢弃**每个自定义对象 |
| WebGL 渲染自定义对象 | `SceneExtractor.register(Ctor, extractor)` | 对象 → 几何 | GL 路径画洋红诊断菱形 |

规则：

1. **后注册者优先，内置类型仍先匹配**：子类可覆盖基类而不必反注册。
2. 应用代码在保存/渲染路径上抛错只损失该对象，不允许带崩整帧/整份存档（两道保护 + 诊断记录）。
3. 推荐在同一个函数里绑定对称注册（example-10 的 `persistence.ts` 是范本）。
4. 四个面都提供了 `unregister*` 方法，但注册**不返回释放句柄**（不能挂 try/finally 或随场景自动注销），且注册表是**静态全局**、无场景作用域、无测试重置钩子——测试间需记得手工反注册。这是已知的扩展面债务（G6 关联项）；Pixi v8 的教训是单包显式注册 API + 子路径导入，不要引入副作用安装与多包单例。

---

## 7. 框架级设计原则

这些是从 FRAMEWORK_ANALYSIS 数百条修复中提炼的「元规则」，评审新代码时逐条对照。

1. **时间账只能有一个实现。** 新写的从时间戳算增量的代码必须用 FrameClock；同一缺陷出现 12 次后，答案不是「下次注意」而是共享类 + 共享契约表。
2. **孪生类规律：同一缺陷往往在孪生类里各有一份。** AnimationController/DirectionalAnimator、加载/保存注册表、2D/GL 两份形状常量、两个 overlay——修一处不等于修完；共享常量必须三处（draw/aabb/extractor）同源。
3. **文档写得完整、测试却是零的模块，实现几乎必然已与文档分叉。** AudioManager、ObjectPool、InputMap、AssetLoader、DirectionalAnimator、ParticleSystem、ClickMover 七轮 0%→高覆盖每一轮都在无人覆盖分支里发现缺陷。
4. **先立契约测试，再做重构。** FrameClock 落地顺序是刻意的：先有 FrameDeltaContract 表，再迁十个模块；974 个用例是「行为完全等价」的依据。
5. **断言必须钉在会失败的场景上。** 写断言后做对照实验（短路掉修复）确认它真的会红；四根单格柱子拦不住直线追击，真正需要寻路的是带缺口的长墙。
6. **构造只建状态，不发事件。** 回调在构造函数触发会让 `const x = new X()` 绑定完成前进入 TDZ；`start()` 独立成步。
7. **坏一条目不毁一整帧/一整份数据。** 外部注册代码必须故障隔离。
8. **测量先于优化；没人能读的预算不是门禁。** ACCEPTANCE 七行性能预算中只有两行有仪表时，「优化在 profiling 之后」无法执行；先让数字可测。
9. **把猜测变成钉住的事实，比留 TODO 有用。** 不能马上改的缺陷，写成测量断言（实测范围 + 不变量）并注释「这两个数要一起改」。
10. **重构不该偷偷改行为。** 迁移时用 `const first = !clock.started` 显式保留旧差异，而不是顺手统一。
11. **示例先验手感，值得再上升为引擎决策。** 动态体分离先在 ArenaRun 以 O(n²) 验证；引擎级版本需要空间分桶，那是另一个决定，不由示例替引擎定。
12. **整局事实只有整局能暴露。** 「示范玩法赢不了」「Boss 距离压迫」「读档后回调静音」这类集成缝，模块测试永远碰不到——所以规则层必须无头可跑。
13. **工具错误也是素材。** PowerShell 写 BOM 被编码门禁拦下、YAML 注入无人检查——把它变成 `encoding:check`、`lint:workflows`，让同类错误下次在 CI 红。

---

## 8. 差距分析与改进提案

编号 G1–G12 与 [REFERENCES.md §15 对照表](./REFERENCES.md#15-跨资料规律对照表)一一对应。排序依据：**正确性 > 可扩展性负债 > 仪表与发布阻塞 > 增强**。每条给现状、参照、具体做法与代价；这是设计提案，不是已批准的工单，落地时各自配对照实验与契约测试。

### P0 — 正确性边界

#### G1. 固定步补发只有间接封顶，缺显式契约

> **2026-10-24 已落地**：`Engine.maxFixedStepsPerFrame`（默认 8，即现状 7+1，零行为变化）+
> `deferredFixedSteps` 可观测计数 + 余额结转策略写入字段文档；契约由
> `EngineFixedStepCap.test.ts` 钉住（封顶、结转不丢时间、非正数按 1 处理）。剩余：若未来要
> 更激进的慢放（如 4 步），需同时更新现有「100ms 欠 6 步」断言——那是单独的手感决定。

- **现状（实测推导，不是猜测）**：`Engine._tick` 的 while 循环没有步进上限，但每帧步进数已被 `FrameClock` 的 100ms 钳制间接封顶——循环结束时 `acc < fixedDeltaTime`（<16.7ms），下一帧 `acc ≤ 100 + 16.7ms`，故单帧最多 **7 个**固定步。经典死亡螺旋（无限补发）在当前代码里不会发生；真正缺的是：① 这个 7 只是推导出来的，不是命名常量；② 超出预算时的策略（结转/丢弃/慢放）没有文档化，未来有人调大 `MOTION_MAX_DT` 或给 System 加内嵌步循环就会重新打开风险。
- **参照**：Fiedler/Nystrom 要求钳帧时间 + 步进封顶；lockstep 明确每渲染帧 ≤4 模拟步。
- **提案**：把策略写成显式契约——新增 `maxFixedStepsPerFrame`（默认 8，即「现状 7 步 + 1」，不改变任何现有行为）与「余额结转」为唯一明文策略；超过时保留余额结转下帧（慢放）并递增一个可观测计数（供 G10 的仪表读取），而不是静默吞帧；契约表增加「长帧步数不超过常量」用例。
- **代价**：极小；Engine 一处 + 测试，无行为变化。若未来要更激进的慢放策略（如 4 步封顶），那是单独的手感决定，需同时更新现有「100ms 欠 6 步」的测试断言。

#### G2. 固定步状态无渲染插值（alpha）

- **现状**：fixedUpdate 与 update 同帧执行，渲染读当前状态；60Hz 显示尚可，120/144Hz 下运动抖动，固定步的全部收益只用了一半。
- **参照**：Fiedler 终版算法 `alpha = accumulator/fixedDeltaTime`，渲染在 previous/current 间插值。
- **提案**：先不做通用插值框架（会侵入全部 IsoObject）；分两步：① Camera 先行（相机位置存 previous/current，draw 按 alpha 取）——手感收益最大、改动最小；② 为需要平滑的运动对象提供可选 `RenderInterpolated` 接口，抽取/绘制层按 alpha 读位置，模拟状态保持权威不变。alpha 同时供未来的预测调试。
- **代价**：中；接口设计是主要成本，可先在 example-02 验证手感。

### P1 — 可扩展性负债

#### G3. System 匹配每帧 O(实体×系统) 重建

- **现状**：每次 update 与 fixedUpdate 都全量重扫；分析报告自评「千级实体后引入缓存」。
- **参照**：flecs「查询绝不每帧重建」、archetype 表查询成本趋零；Excalibur 缓存查询；ecs-faq 结构变化才失效。
- **提案（不上 archetype 的版本）**：Scene 维护**结构版本号**（addComponent/removeComponent/对象增删/可见性变化时自增）；每个 System 缓存匹配数组与最后所见版本，版本未变直接复用。组件当前在 Entity 内部 Map 上，需要 Entity 在组件变更时通知属主 Scene（挂载回调已知道 entity，加一个内部 dirty 标记即可）。进一步：匹配从「every 全扫」优化为「组件类型 → 实体集合」的稀疏索引（每 ComponentCtor 一个 Set，query 取最稀有集合起遍历），这是 sparse-set ECS 的核心廉价形态。
- **代价**：中；需同时定义「组件在 System 运行中增删」的语义（与 G4 一起做，否则缓存失效时序不可解释）。验收：千级实体 ×10 系统的调度微基准；现有全部 System 测试不变。

#### G4. 帧中结构性突变没有同步点

- **现状**：`addObject` 立即入数组（帧中新增会同帧更新）；`removeById` 用 filter 重建（不会跳过元素但产生全量拷贝）；System 内删实体即时生效，行为依赖系统遍历顺序。
- **参照**：flecs `LOCKED_STORAGE` + deferred stage；Nystrom 更新方法的遍历规则。
- **提案**：引入**命令队列**：`scene.spawn(obj)`/`scene.despawn(id)`（保留 addObject/removeById 作为立即语义的显式 API 或内部委托），在 fixedUpdate 批次之后、update 批次之后两个同步点统一提交；命令在提交前可撤销；despawn 先标记、统一清扫（FloatingText 已有就地压缩清扫的先例）。文档保证：同一帧内 System 看到的实体集合稳定。
- **代价**：中高；属公开语义变更，需迁移内部调用点与 example，但这是 G3/G5/G6 的前置，收益最大。

#### G5. 实体 id 无代次（generation）

- **现状**：id 是调用方给的字符串；删除后用同名 id 新建对象，旧引用无法分辨；事件 payload 若携带 id（§4.7 建议携带）会命中新实体。
- **参照**：flecs 回收 id 高 32 位代次、`is_alive()` 失效句柄。
- **提案**：内部引入 `EntityHandle = {id, gen}`（不改公开字符串 id 的存档形状）；Scene 维护每 id 代次计数，despawn 自增；事件/命令携带 handle，消费时校验。存档只存字符串 id（代次是会话内概念）。
- **代价**：中；依赖 G4 的同步点。

#### G6. 事件生命周期与扩展注册面的所有权

> **2026-10-24 部分落地**：`bus.bag()` 作用域订阅包（`EventSubscriptionBag`）——场景
> onEnter 订、onExit 一键 release，关闭后的 bag 订阅立即退订；由 `EventBusBag.test.ts`
> 钉住。其余（自动随实体/场景死亡退订、即时/排队两层语义、注册表返回注销句柄与实例化）仍开放。

- **现状**：`globalBus`/自建 EventBus 的订阅靠手工 off，场景拆除不自动退订（闭包持有旧场景 = 泄漏 + 幽灵响应）；无即时/排队之分、无排空时刻、无订阅句柄；四个注册面是静态全局。
- **参照**：Godot 信号随对象释放自动断连；Babylon Observable 返回 disposable；Bevy 事件两帧未读丢弃 + Observer 即时机制。
- **提案**：
  1. `bus.on(...)` 返回 `() => void` 释放句柄；提供 `bus.scoped(scene|entity)` 绑定属主，属主销毁时批量退订（SceneManager 回滚路径也要覆盖）。
  2. 文档化两层语义：默认**即时广播**（现状）；新增可选**帧队列**（在帧序固定阶段排空，payload 必须是值快照），满容量断言。
  3. 注册表四个面已有 `unregister*`，但应让 `register*` **返回一次性注销句柄**（与 1 的 bus 句柄同形），并补「测试后重置」钩子；长期评估改为实例级 registry 挂在 Engine，静态 API 保留为默认实例的委托（像 Pixi v8 那样避免多实例互相污染）。
- **代价**：中；1 是纯增量可先行，2 需要帧序决策，3 影响包的初始化形态放 Phase 5 一起做。

### P2 — 规模与内容管线

#### G7. 引擎级动态体概念；稠密排序桶与地图分块

- **现状**：碰撞只对瓦片；单位重叠靠示例层 O(n²) 推开；深度排序同桶稠密退化 O(n²)；地图不分块，lightmap/绘制随地图尺寸增长。
- **参照**：Nystrom 空间分区（格 > 最大交互半径、移动时重入桶）；ecs-faq「空间索引每帧从查询重建，不内嵌 ECS」。
- **提案（一个统一的空间索引服务，三处复用）**：
  1. `SpatialHash`（cell 大小 ≥ 最大交互半径，主对象列表之上的二级索引）服务于：动态体分离（把 ArenaRun.\_separate 上升为引擎可选服务，推开仍过 sweepMove，死者不参与，确定性平局规则保留）、排序桶候选对、未来触发区查询。
  2. 排序 broad phase 在基准验证后评估 sweep-and-prune 或分层 chunk。
  3. 地图 chunk：GL 路径把整层 Floor 合并为单 quad 是 ROADMAP Phase 5 已识别的最低成本优化（当前仍是 6 顶点/可见瓦片，floor 占抽取顶点的三分之二）；Canvas lightmap 与绘制按脏区分块是后续。
- **代价**：高；必须先有规模基准（G10 的仪表是前置），按「先在示例验手感、值得再上升」原则推进。

#### G8. 输入上下文栈、gamepad、动作死区

- **现状**：InputMap 有动作/轴/绑定序列化，但不能作为整体 enable/disable；无手柄轮询；死区在 TouchStick 而非 per-action。
- **参照**：Unity InputActionMap 整表启停；Unreal Mapping Context 优先级压栈；Godot per-action deadzone；Gamepad API 轮询模型。
- **提案**：① `InputMap` 增 enabled 与上下文栈（push/pop，高优先级赢冲突），菜单/游戏/过场切换不再逐动作解绑；② InputManager 增加 gamepad 每帧轮询（standard 映射、热插拔、边沿入同一套 pressed/released）；③ deadzone/scale/invert 提升为 per-binding modifier（Unreal 管线的廉价版）；④ 意图注入接口正式化（ArenaRun intent 已有事实，补文档与类型导出）。
- **代价**：中；①②独立可做，③需要轴合成的回归矩阵。

#### G9. 存档版本与规范化

> **2026-10-24 部分落地**：`SceneSerializer.FORMAT_VERSION = 1` 写入存档根记录；
> `checkVersion()` 缺字段=旧档接受、高于已知版本或非法值=拒绝（`Engine.buildScene`
> 响亮抛错而不是静默错载）；由 `SaveVersion.test.ts` 钉住（含 round-trip）。剩余：
> 迁移链（格式首次变更时挂上）、规范化字节编码。

- **现状**：根记录无版本字段；无迁移机制；键顺序依赖产生方，无法对存档做字节哈希/diff。
- **参照**：Godot 存档教程（显式参与者 + 场景名重建）；RFC 8785 JCS（键排序 + 数字唯一形式）。
- **提案**：根记录加 `formatVersion: 1`；读取侧建立 `migrations: {(v) => v+1}` 链，未知高版本拒绝；提供可选规范化输出（键排序、固定数字形式）供测试与未来存档校验和；round-trip 测试新增「同状态两次导出字节一致」。
- **代价**：小；版本字段与迁移骨架先行，规范化可后补。

### P2 — 仪表（让既有预算成为门禁）

#### G10. 热路径计量：每帧分配、p95、GPU 时间

- **现状**：ACCEPTANCE 七行性能预算只有两行有仪表（draw calls、context restore）；CPU extraction 有分项计时但参考负载从未跑满；FPS 只有均值且两处算法不一致；无每帧分配计量、无 GPU timer。
- **参照**：Unity 把热路径分配当独立性能面；ROADMAP Work Order 6「profiling 之后才优化」。
- **提案**：
  1. 每帧 JS 分配：开发构建用 `performance.measureUserAgentSpecificMemory` 不可行（粒度过粗）——采用测试侧计数器（arena 之外的热路径禁用增长数组/闭包，配 ESLint 规则或 code review 清单）+ 长跑前后 heap 差的基准脚本，给 ≤16KB/帧一个可重复的读法。
  2. 帧时间直方图与 p95（FrameClock.sample 被钳过不能用于尾部统计——仪表要在钳制前记录原始值），统一 DebugRenderer 与预览页两处 FPS。
  3. GPU：请求 `EXT_disjoint_timer_query_webgl2`，把 GPU pass 时间接进 RenderStats；请求失败时该预算行显示「无仪表」而不是假装通过。
  4. 跑一次 ACCEPTANCE 的名义参考负载（10k 地砖/1k 对象/20k 粒子/16 灯），把「预算 vs 实测」写成一页基线（已知 4.56ms 超 4ms 预算行、49 props 已超标——先承认数字再优化。`MAX_OMNI_LIGHTS` 已于 2026-10-17 裁决为 16 并由无头测试钉住，溢出在 `stats.omniLightsDropped` 单独计数）。
- **代价**：中；主要是基准工程，不改产品代码。

### P3 — 接口债与发布

#### G11. AABB 契约需要瓦片尺寸上下文

- **现状**：`aabb` 是无 draw 上下文的 getter，Tree/Cloud/FlowerPatch 声明盒与实画不符，四个类会画到 baseZ 以下（测量值已在分析报告中钉住）；修它需要给 aabb 传 tileW/H，是公开接口变更。
- **提案**：在下一个 minor 版本提供 `aabb` 的上下文形态（如 `getAABB(tileW, tileH)`，旧 getter 保留为标准瓦片近似并标注）；draw/aabb/extractor 三处共用形状常量的模式（Boulder.SQUASH、Crystal.TIP_FACTOR）推广到全部可绘制类；配合 WebGL 基线重生成。
- **代价**：中；接口迁移 + 像素基线审批流程。

#### G12. 确定性与回放的预留项

- **现状**：规则层已可 `step(dt, intent)` 无头驱动，但框架无播种 RNG 资源，云/粒子/天空有的用了固定种子 LCG、用法不统一。
- **提案**：提供框架级 `RngSource`（整数种子、序列确定），文档化「模拟代码不得调用 Math.random」（渲染/装饰可豁免）；确定遍历顺序审计（Map 迭代、对象枚举）；未来回放 = 初始存档 + 帧号 + intent 流 + 校验和（Fiedler lockstep 模型），不承诺跨浏览器位相同。
- **代价**：小（RNG 与文档），回放本身是另一个项目。

#### 发布线相关（非新增设计，引用既有计划）

- 渲染后端选择接入 Engine 公共构造选项（webgl-next Phase 5/6）：能力探测 → WebGL2 → Canvas2D 兜底，单一 fallback 警告；后端选择是渲染器唯一异步边界（Pixi v8 形态）。
- 场景状态补「暂停可见 / 休眠保留」之分（Phaser 三正交轴），覆盖层场景停更新仍渲染。
- webgl-next/ARCHITECTURE.md 的坐标小节仍残留旧双 Z 描述（与 §4.2 矛盾的文字），应随本文档一并更正。

### 8.1 提案依赖关系与建议顺序

```text
G1（步进封顶）─────────────────── 独立，先做
G4（命令缓冲/同步点）─┬─ G3（查询缓存）
                     ├─ G5（id 代次）
                     └─ G6（事件作用域）
G2（渲染插值，相机先行）────────── 独立
G9（存档版本）────────────────── 独立
G10（仪表）─┬─ G7（空间索引/分块）
            └─ Phase 5（后端接线；MAX_OMNI_LIGHTS 已裁决为 16）
G8（输入上下文/手柄）──────────── 独立
G11（aabb 上下文）─────────────── 随 minor 版本
G12（确定性预留）──────────────── 随玩法需要
```

---

## 9. 决策记录（ADR 摘要）

完整版背景见 FRAMEWORK_ANALYSIS.md；此处只留决策与理由的骨架。

| # | 决策 | 理由要点 |
|---|---|---|
| ADR-001 | Canvas2D 为默认后端，WebGL2 经 RenderSnapshot 预览接入 | 永远有回退；每阶段 main 可发布；后端切换不动玩法状态 |
| ADR-002 | 固定步长模拟（60Hz 累加器）+ 可变帧率渲染 | 物理/AI 帧率无关、确定、可复现；手感问题（144Hz 2.4 倍速）的统一答案 |
| ADR-003 | Z 单位统一为屏幕像素 | 双单位只在 tileH=32 自洽，非标准瓦片下两后端落点不一致；换算常量删除 |
| ADR-004 | FrameClock 单点帧时间契约 + 共享契约用例表 | 同缺陷 12 次；模块测试无法为不存在的模块失败 |
| ADR-005 | 组件以构造函数引用为键、query 是构造函数数组 | 类型安全、可重构；字符串 key 无静态约束 |
| ADR-006 | EventMap 类型化事件，组件只 Pick 所需事件 | 名称/payload 同源约束；应用可扩展事件集 |
| ADR-007 | 扩展一律注册表（加载/保存/抽取四面对称），后注册者优先 | 开闭原则；自定义类型在每个方向都不被静默丢弃 |
| ADR-008 | 逻辑像素契约；DPR 自动推导并钳到 2；resize 才启用 | DPR³ 填充率中端机不可承受；构造不改既有页面行为 |
| ADR-009 | HUD 不移植 GL，叠加透明 2D canvas 复用 HudLayer | 不产生第二套要同步的控件实现；paint 钩子承载自绘 |
| ADR-010 | 像素门禁用绝对像素棘轮（2500），道具级不变量下沉快照层 | 比例门禁放行 6 倍大道具；全局预算结构上保护不了单道具；无阈值快照断言才抓得住 |
| ADR-011 | 规则层 `step(dt, intent)` 与 DOM/渲染分离 | 整局可无头断言；意图可注入（真人/AI/测试同源） |
| ADR-012 | 应用注册代码故障隔离（坏对象不毁整帧/整档） | 扩展点跑的是不受信应用代码 |
| ADR-013 | 场景栈事务化：先建后退、finally 装载、失败回滚含资产释放 | 异常路径下栈/引擎/资产三者必须始终一致；旧症状（输入失灵、画面冻结）无法从症状诊断 |
| ADR-014 | 覆盖率/像素阈值一律棘轮，禁止为过构建而下调 | 门禁的可信度来自单调方向 |
| ADR-015 | 示例内的引擎级候选方案（动态体分离等）保持小规模显式写法，不提前替引擎定型 | 先验手感与真实负载，再付空间分桶的复杂度 |

---

## 10. 术语表

| 术语 | 含义 |
|---|---|
| IsoView | `{rotation, elevation}`，场景级等距投影视图；旋转 0/90/180/270，elevation 为俯角参数（默认 0.5） |
| tileW/tileH | 菱形瓦片的宽/高（逻辑像素，默认 64×32） |
| AABB | 排序用轴对齐包围盒：世界位置 + `baseZ`/`maxZ`（屏幕像素高度）；零高度退化为 `MIN_Z_EXTENT_PX=16` 薄片 |
| topoSort | 以深度冲突对为边的拓扑排序（Kahn + min-heap），产出背靠背绘制序 |
| RenderSnapshot | 一帧的渲染器中立数值记录，模拟→渲染的唯一桥 |
| arena | 抽取层复用的交错 Float32Array，按 floor/shadow/opaque/transparent/debug 区间写入 |
| segment | 合批段：blend/纹理一致且无顺序冲突时连续延伸的一次绘制 |
| FrameClock | dt 推导契约的唯一实现：null 基线、[0,maxDt] 钳制、reset 语义 |
| 动作/轴（action/axis） | InputMap 的语义层；action 是数字边沿/按住，axis 是多源合成后长度≤1 的模拟向量 |
| AxisSource | 模拟量输入接口（TouchStick 是首个实现）；死区与重缩放后供 axis() 相加 |
| 命令缓冲（command buffer） | G4 提案：spawn/despawn 排队到帧内同步点提交，迭代中实体集合稳定 |
| 结构版本（structural version） | G3 提案：组件/实体集合变更时自增的版本号，查询缓存据此失效 |
| 代次（generation） | G5 提案：会话内实体句柄的失效校验，存档形状不含代次 |
| 棘轮（ratchet） | 只允许单向收紧的阈值 |
