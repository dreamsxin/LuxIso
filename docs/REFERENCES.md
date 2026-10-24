# 游戏框架设计资料汇编

> 收集日期：2026-10-17
> 用途：为 LuxIso 框架设计（见 [DESIGN.md](./DESIGN.md)）提供外部参照。每条资料均经实际访问验证（含跳转后的最终地址），并附**对 LuxIso 的具体启示**，不是泛泛的书签。
> 读法：先看末尾的「跨资料规律对照表」，需要细节时再回到对应条目。

## 目录

1. [游戏循环与时间步](#1-游戏循环与时间步)
2. [ECS 架构](#2-ecs-架构)
3. [场景与状态管理](#3-场景与状态管理)
4. [事件与信号](#4-事件与信号)
5. [渲染后端抽象与渲染图](#5-渲染后端抽象与渲染图)
6. [等距渲染、深度排序与空间分区](#6-等距渲染深度排序与空间分区)
7. [GPU 资源生命周期](#7-gpu-资源生命周期)
8. [Web 平台契约](#8-web-平台契约)
9. [输入抽象](#9-输入抽象)
10. [存档与序列化](#10-存档与序列化)
11. [音频引擎设计](#11-音频引擎设计)
12. [对象池与 GC 友好的主循环](#12-对象池与-gc-友好的主循环)
13. [JS/TS 引擎横向调研](#13-jsts-引擎横向调研)
14. [可测试性与确定性](#14-可测试性与确定性)
15. [跨资料规律对照表](#15-跨资料规律对照表)

---

## 1. 游戏循环与时间步

### 1.1 Fix Your Timestep! — Glenn Fiedler

<https://gafferongames.com/post/fix_your_timestep/>

- 渲染器**生产时间**，模拟以固定大小的 `dt` 块**消费时间**；半固定的 `min(frameTime, dt)` 切分会触发**死亡螺旋**（追赶用的计算比被追赶的真实时间还贵，亏空越来越大）。
- 最终算法：先钳制帧时间（`if (frameTime > 0.25) frameTime = 0.25`），累加，`while (acc >= dt)` 步进固定步长，余额结转。
- 渲染用上一状态与当前状态按 `alpha = accumulator / dt` 插值；渲染有意落后模拟一个步长。
- 固定步长让物理跨帧率确定、可复现；可变 dt 会让弹簧爆炸、快速物体穿透。
- **对 LuxIso**：60Hz 累加器与 `[0, maxDt]` 钳制正是该模式；但 `Engine._tick` 的 while 循环**没有步进次数上限**，应补「每帧最多 N 个固定步」（见 DESIGN.md 差距分析 G1）；渲染插值 alpha 目前也不存在（G2）。

### 1.2 Game Loop — Robert Nystrom,《Game Programming Patterns》

<https://gameprogrammingpatterns.com/game-loop.html>

- 意图：「把游戏时间的推进与用户输入、处理器速度解耦」；循环绝不阻塞等待输入。
- 推荐「固定更新 + 可变渲染」（catch-up lag 累加器）；`MS_PER_UPDATE` 是模拟粒度，不是显示刷新率。
- 必须给内层 while 加上限：慢机器上让游戏变慢，而不是锁死。
- 浏览器拥有事件循环，主循环由 `requestAnimationFrame` 驱动。
- **对 LuxIso**：`FrameClock` 的 `null` 首帧哨兵与钳制已与本书一致；时间步契约应作为框架级文档而非口头约定（已落地为共享用例表 `FrameDeltaContract.test.ts`）。

### 1.3 Update Method — Nystrom

<https://gameprogrammingpatterns.com/update-method.html>

- 更新内绝不阻塞；帧内更新顺序是**可观察的**：A 先于 B 意味着 A 看到的是 B 的旧状态。
- **帧中新增的实体可能同一帧就被更新**——遍历开始时缓存长度；前向遍历中删除会跳过元素，应后向遍历、调整索引或延迟到批量清扫。
- 休眠实体仍消耗迭代时间；enabled 标志 vs 独立活跃集合是真实的权衡。
- **对 LuxIso**：`Scene.update` 当前在系统遍历后直接遍历对象数组（`addObject` 帧中加入会同帧更新，且 `removeById` 用 filter 重建所以不会跳元素）；未来引入命令缓冲后应明确「生成/销毁在同步点提交」的语义（G4）。

### 1.4 Deterministic Lockstep — Glenn Fiedler

<https://gafferongames.com/post/deterministic_lockstep/>

- 相同初始状态 + 相同逐帧输入必须产生**位相同**结果；逐帧校验和是定位首次分歧帧的测试预言机。
- 隐藏的 RNG（哪怕在物理解算器内部）和无序遍历都会破坏确定性；RNG 按帧号播种。
- 固定模拟帧采样紧凑输入结构；没有第 n 帧输入就不推进第 n 帧。
- 追赶**每渲染帧最多 4 个模拟步**以防死亡螺旋。
- 跨平台浮点确定性很脆弱（编译器/OS/架构、debug/release 都可能不同）。
- **对 LuxIso**：`ArenaRun.step(dt, intent)` 就是「（帧号, 输入快照）→ 状态」的可测函数；若以后要做回放/联机，需要框架级的播种 RNG 资源、确定的遍历顺序和「模拟状态 + 累加器 + 帧号」快照定义。

---

## 2. ECS 架构

### 2.1 Entity Component System FAQ — Sander Mertens（flecs 作者）

<https://github.com/SanderMertens/ecs-faq>

- 定义：实体 = ID；组件 = 纯数据（tag = 零数据组件）；系统 = 匹配组件集合的函数；query = 不运行的系统。
- 存储分类法：**archetype/table**（列式连续，多组件查询最快，结构变动有迁移成本）、**sparse set** 每组件一套（增删最快，EnTT/Shipyard；从最稀有集合起迭代）、**bitset**（Specs、EntityX）、reactive（Entitas）。
- archetype 查询缓存匹配的 table；table「很快稳定」，匹配成本趋零——前提是查询被**复用**而不是重建。
- 频繁增删组件会把 archetype 打碎成大量小表；空间索引不要内嵌进 ECS，每帧从查询重建。
- **对 LuxIso**：成熟 ECS 无一例外避免每帧重建匹配，而 `Scene._refreshSystemMatches` 每帧做 O(实体×系统) 扫描——这是当前最明确的扩展性负债（G3）。

### 2.2 Flecs FAQ — Sander Mertens

<https://github.com/SanderMertens/flecs/blob/master/docs/FAQ.md>

- 查询是最快的迭代路径但**创建昂贵——绝不在系统/循环内创建**；结构变动在迭代中进行是硬错误（`LOCKED_STORAGE`），变更经 deferred stage 在同步点合并。
- 回收 ID 使用高位 generation；过期句柄报告 `is_alive() == false` 而不是别名到新实体。
- 内置变更检测（`OnSet`）优于用户手写脏标记。
- **对 LuxIso**：System.query 在类上声明一次（已正确）；生成/销毁应延迟到同步点（G4）；实体 id 目前是裸字符串、无 generation（G5）。

### 2.3 bevy_ecs API docs — Bevy

<https://docs.rs/bevy_ecs/latest/bevy_ecs/>

- 相同组件集合的实体共享 **archetype**；频繁开关的组件可放 SparseSet 存储。
- 系统参数声明数据访问，调度器据此做无冲突并行与排序——**不靠注册顺序**。
- `With`/`Without`/`Changed`/`Added` 查询过滤让变更检测成为一等公民。
- 系统间消息是缓冲通道；**未读消息默认两次 update 后丢弃**——读取方每帧必须排空；Observer 是另一种即时反应机制。
- **对 LuxIso**：类型化 EventMap 方向正确，但需要定义事件的逐帧排空/生命周期策略与「即时 observer vs 排队事件」之分。

### 2.4 EnTT 官方文档 — Michele Caini

<https://skypjack.github.io/entt/>

- 底层是 sparse set；views/groups 覆盖从 SoA 到随机访问的不同工作负载，按基准选择。
- 组件指针稳定性可选；`create()` 回收已销毁标识符。
- **对 LuxIso**：场景切换时实体频繁增删 tag，若将来升级存储，每组件类型一套 sparse set + 每查询缓存 view 是与本框架规模匹配的形态，无需一步到 archetype。

### 2.5 Entity Systems are the future of MMOG development, Part 3 — Adam Martin

<https://new.t-machine.org/index.php/2007/12/22/entity-systems-are-the-future-of-mmog-development-part-3/>（t-machine.org 301 跳转到此）

- 「实体是一个数字」；所有数据进组件，系统提供行为。
- 实体的组件集合在概念上应是**数据库查询结果**，而不是对象列表。
- 实体 prefab 是「模板/装配（assemblage）」，用构造代替构造函数层级。
- **对 LuxIso**：组件保持可序列化纯数据袋，是 snapshot/restore 简单的根本原因；也支持「实体长期应趋向 ID 而非类实例」的演进方向。

### 2.6 Component — Nystrom

<https://gameprogrammingpatterns.com/component.html>

- 按领域（输入/物理/图形/AI/音频）拆上帝对象；组合优于继承。
- 兄弟组件通信的三种方式各有代价：共享容器状态（隐式、依赖顺序）、直接引用（快但耦合）、经容器发消息（Mediator，排队即 Event Queue）。
- **对 LuxIso**：应在设计文档中写明**受认可的通信通道**（组件字段 + 显式系统顺序 vs EventBus），避免三种风格各自蔓延。

---

## 3. 场景与状态管理

### 3.1 State — Nystrom

<https://gameprogrammingpatterns.com/state.html>

- FSM：固定状态集、单一当前状态；一个枚举字段消除不可能的布尔组合。
- 入/出状态动作避免转换重复；让 `update()` 返回新状态，由属主在调用结束后释放旧状态（**绝不在方法执行中释放活动状态**）。
- **下推自动机（pushdown automata）**是覆盖层历史的命名模式：push 覆盖状态、pop 回到之前——正是菜单压在游戏上的形态。
- 正交的关注点用并发状态机（n+m 而不是 n×m 个状态）。
- **对 LuxIso**：SceneManager 的 push/pop 就是下推栈；`replace()` 的「先建后退、失败回滚」与「活动状态不可中途释放」是同一条规则。

### 3.2 Node / Scene Tree — Godot 4 文档

<https://docs.godotengine.org/en/stable/classes/class_node.html>

- 进入回调父先子，ready 回调**子先父**；退出子先父。
- `_process`（渲染帧）vs `_physics_process`（固定 60Hz）——引擎本身就分两个更新域。
- `process_priority` 小的先执行，同优先级按树序：显式优先级 + 确定性平局规则。
- 暂停是逐节点的 process mode（Inherit/Pausable/WhenPaused/Always/Disabled）。
- 释放父节点自动释放子节点；指向被释放对象的信号连接自动清理。
- **对 LuxIso**：System 的 priority + 注册序平局规则与此一致；场景栈需要明确的暂停传播策略；事件订阅应随实体/场景销毁自动摘除（当前 `EventBus.off` 靠调用方自觉，G6）。

### 3.3 SceneManager — Unity ScriptReference

<https://docs.unity3d.com/ScriptReference/SceneManagement.SceneManager.html>

- `Single` 替换全部场景；`Additive` 多场景并存；异步加载返回 `AsyncOperation`，**激活可延迟**（先预载再切换）。
- 一个 active scene 决定新对象落点；生命周期事件 sceneLoaded/sceneUnloaded/activeSceneChanged。
- **对 LuxIso**：`replace()` 已采用「先构建后切换」；异步工厂 + 延迟激活是下一个自然形态，保证任何时刻不更新半成品场景。

### 3.4 ScenePlugin / Scene systems — Phaser 3

<https://photonstorm.github.io/phaser3-docs/Phaser.Scenes.ScenePlugin.html>
<https://docs.phaser.io/phaser/concepts/scenes>

- 三条正交轴：start/stop（关闭清场）、pause/resume（**更新停、渲染继续**）、sleep/wake（两者都停但保留监听/状态）；launch 并行场景。
- 生命周期 `init → preload → create → update`；唤醒不重走 init/create。
- 每个状态变更都**延迟到下一次 Scene Manager update**，绝不即时生效；并行场景的渲染顺序是显式 z 序表。
- **对 LuxIso**：「暂停但仍可见（覆盖层）」与「休眠保留」应成为一等场景状态；场景操作在边界提交应写成明文保证。

---

## 4. 事件与信号

### 4.1 Signal — Godot 4

<https://docs.godotengine.org/en/stable/classes/class_signal.html>

- 信号让响应方「不直接引用彼此」；发射方对监听方一无所知。
- 优先类型化连接；重复连接报错（除非引用计数）；目标对象释放时连接自动死亡。
- 有一次性标志；可用 `get_connections()` 检视。
- **对 LuxIso**：全局单例 `globalBus` 应在场景/实体销毁时自动退订（弱绑定或场景级 bus），并拒绝重复处理器。

### 4.2 Event Queue — Nystrom

<https://gameprogrammingpatterns.com/event-queue.html>

- 仅在需要**时间解耦**时排队；单纯静态解耦 Observer 更便宜。
- **过期世界状态**：排队事件几帧后处理时，引用的实体可能已被删除/移动——所需数据要快照进 payload。
- **反馈环**：A→B→A 的循环异步化后不会栈溢出，而是悄悄循环传播假事件；规则：不在处理器内再发射同类事件。
- 中央队列「实际上就是全局变量」；固定容量环形缓冲 + 满队列断言；事件（过去的事实、广播）与消息/命令（未来的请求、单接收者）是两种东西。
- **对 LuxIso**：事件 payload 应携带值快照或带 generation 的实体 ID，不携带活实体引用；区分命令与通知；`damage/heal/death` 这类事实广播目前没有帧排空策略。

### 4.3 Observables & Observers — Babylon.js

<https://doc.babylonjs.com/features/featuresDeepDive/events/observables>

- 统一的 `Observable<T>`/`Observer` 取代零散回调字段；Scene 的 20+ 生命周期钩子按**文档化的确定性帧序**触发。
- `add` 返回一次性释放句柄；支持 `addOnce`、掩码过滤、前插优先级；派发中删除是安全的。
- 帧内定时任务走 tick observable，不用 `setTimeout`。
- **对 LuxIso**：注册式扩展点（extractor/serializer）应返回可注销句柄并绑定场景 dispose；当前静态全局注册表（`Engine._propRegistry`）无场景作用域，测试间需自行清理。

---

## 5. 渲染后端抽象与渲染图

### 5.1 WebGPU Specification — W3C

<https://www.w3.org/TR/webgpu/>

- 为 Vulkan/Metal/D3D12 类现代 API 从零设计，与 WebGL 无关。
- **三条时间线**：content（JS）、device（驱动）、queue（GPU 执行）——工作被录制而非立即执行。
- `GPUAdapter`（一次性、可能是 fallback adapter）→ `GPUDevice`，设备是全部资源的唯一属主；设备可 lost/destroy，子资源随之失效。
- 资源带显式 usage 标志；bind group layout 预校验绑定而非依赖全局可变状态。
- 能力通过可选 features + 数值 limits 查询。
- **对 LuxIso**：`RenderSnapshot` 在 content 时间线生成、renderer 在 device/queue 时间线消费，与该模型同构；设备丢失是一等事件：丢弃 GPU 子资源，生产侧（Scene/ECS）不受影响——这正是 ARCHITECTURE.md 的所有权规则。

### 5.2 WebGPU Fundamentals — Gregg Tavares

<https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html>
<https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html>

- `requestAdapter` → `requestDevice`；设备可能返回即已丢失，要 await `device.lost`（驱动升级、GPU 崩溃、eGPU 拔出、后台回收）。
- 资源创建后尺寸/usage/格式不可变——**替换而非重配**。
- 能力检测模式：探测 → 按需求声明 `requiredFeatures/requiredLimits`，只申请用到的；多申请会掩盖桌面假设、在手机上失败。
- 给每个 GPU 对象打 label；pass 只录制，`finish()` + submit 才生效。
- **对 LuxIso**：Canvas2D 是保证可用的兜底，WebGL2/WebGPU 经一个能力结构选择；arena 尺寸首次提交前要对照设备最小值校验。

### 5.3 bgfx 文档 — Branimir Karadžić

<https://bkaradzic.github.io/bgfx/bgfx.html>

- 一套后端中立 API 覆盖 D3D11/12、Metal、Vulkan、GLES、WebGPU；运行时枚举可用后端。
- 能力门控是 `Caps` 标志位（INSTANCING、INDEX32、COMPUTE、HIDPI…）。
- **View 是排序桶/pass**：每个 view 有自己的变换、清屏、scissor、framebuffer 和排序模式（Default/Sequential/DepthAscending/Descending）。
- 资源为不透明句柄；瞬态顶点/索引缓冲按帧分配；per-draw 状态非留存式。
- **对 LuxIso**：arena 的 floor/shadow/opaque/transparent/pick 区间正对应「view = pass + 排序模式」：opaque 可自由深度排序，transparent 必须严格保持 Kahn 提交序。

### 5.4 sokol_gfx — Andre Weissflog

<https://github.com/floooh/sokol>

- GLES3/WebGL2/GL3.3/D3D11/Metal/WebGPU 之上的薄封装：缓冲、图像、着色器、**pipeline-state 对象**、render pass；刻意不含窗口与着色器翻译。
- 不透明句柄 + desc 结构创建；pipeline 把着色器、顶点布局与状态烤在一起。
- 帧形态：begin pass → apply pipeline → apply bindings → draw → end pass → commit。
- **对 LuxIso**：持久 pipeline 对象 + 每交错 arena 属性一份顶点布局 desc + 每帧 commit 边界，是 Canvas2D/WebGL2/WebGPU 共存所需的最小抽象。

### 5.5 FrameGraph: Extensible Rendering Architecture in Frostbite — Yuriy O'Donnell, GDC 2017

<https://www.gdcvault.com/play/1024612/FrameGraph-Extensible-Rendering-Architecture-in>

- 渲染表达为 **pass 与资源的图**：pass 声明读/写的虚拟资源，图推导执行顺序、资源生命周期/别名、同步屏障，并可裁掉没有输出被消费的 pass。
- **对 LuxIso**：`RenderSnapshot` 已类似 frame graph 的输入；未来后端可把命名区间/灯光/pick 目标编译成 pass DAG（shadow mask → opaque → transparent → pick），而不是硬编码调用序列。

### 5.6 PixiJS v8 迁移指南（架构参考）

<https://pixijs.com/8.x/guides/migrations/v8>

- v8 渲染器**异步初始化**、后端中立（WebGL/WebGPU 同一 API）；全局可变 `settings` 被 options 与可换 DOM 适配器取代（Browser/WebWorker adapter，内置无头/worker 渲染）。
- 场景图不含渲染逻辑；剔除移到渲染循环外的显式 `Culler.shared.cull(...)`。
- 可选功能走**扩展注册表 + 子路径导入**；单包 + 扩展注册修复了 v7 重复包/单例缓存问题。
- **对 LuxIso**：渲染器是唯一异步边界、保持适配器驱动让模拟 DOM-free；剔除是显式抽取 pass（与 SceneExtractor 一致）；扩展注册表要在一个包的显式 API 上，不要靠副作用全局安装。

---

## 6. 等距渲染、深度排序与空间分区

### 6.1 Isometric Tiles Math — Clint Bellanger

<https://clintbellanger.net/articles/isometric_math/>

- 逻辑停留在普通二维方格；屏幕菱形坐标只在渲染/输入时导出。
- 128×64 瓦片：`screen.x = (map.x − map.y) * halfW; screen.y = (map.x + map.y) * halfH`；逆变换用于拾取。
- 相机只是屏幕偏移；分数坐标同样成立。
- **对 LuxIso**：tile 度量（halfW/halfH）+ 相机偏移是投影所需的全部常数；逆变换支撑与渲染器无关的指针→瓦片映射。

### 6.2 TMX Map Format 参考 — Tiled

<https://doc.mapeditor.org/en/stable/reference/tmx-map-format/>

- orientation：orthogonal / isometric（菱形）/ staggered / hexagonal；staggered 带 staggeraxis 与 staggerindex。
- 等距瓦片对象锚点为**底部中心**（正交为左下）。
- 图层按文档顺序渲染；对象层 draworder 为 topdown（y 排序）或 index。
- **对 LuxIso**：等距内容管线应携带显式 orientation；底中心锚点影响排序键使用的 footprint/高度。

### 6.3 Visible Surface Detection（画家算法 / Newell 优先级测试）

<https://www.tutorialspoint.com/computer_graphics/visible_surface_detection.htm>

- 画家算法按深度从远到近绘制；绘制候选 P 前对每个 z 重叠的 Q 做 **Newell 测试**（x/y 范围不相交、P 在 Q 平面远侧、Q 在 P 平面近侧、投影不相交）。
- 全部测试失败（循环遮挡/互穿）时沿平面切分 P 或 Q 后重新插入；切分最坏 O(n²)。
- **对 LuxIso**：这是 `topoSort`（Kahn）的形式化基础：深度冲突对是排序边、范围不相交对无需边；稠密桶 O(n²) 最坏情况正是病态循环遮挡区间，应写进文档而不是藏起来。

### 6.4 Spatial Partition — Nystrom

<https://gameprogrammingpatterns.com/spatial-partition.html>

- 朴素 RTS 两两检查 O(n²)；持久位置局部性（定长网格 + 每格双向链表）把候选缩小为「格子内的小战场」。
- `move()` 只在格子索引变化时重新入桶；格大小应大于最大交互半径。
- 平面网格可预测、移动快，但聚集时退化向 O(n²)；静态几何适合 BSP/kd-tree/BVH，自适应混合用四叉树/八叉树；分区可以是唯一存储，也可以是主列表之上的二级缓存。
- **对 LuxIso**：2D 空间桶是稠密移动场景的正确平坦选择；主对象列表保留（快照遍历/arena 产出都靠它），桶是二级索引；引擎级动态体分离需要空间分桶（ArenaRun 的 O(n²) 分离是个位数规模下的有意选择，G7）。

---

## 7. GPU 资源生命周期

### 7.1 webglcontextlost / webglcontextrestored — MDN

<https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event>

- 丢失处理器里**必须 `event.preventDefault()`**，否则不会触发恢复。
- 丢失后所有 GPU 对象（program/buffer/texture/FBO/uniform 位置）失效，JS 包装还在但 GL 调用变 no-op；`isContextLost()` 查询状态。
- 恢复时重新编译/链接、重新上传、重建 FBO，再启动循环；用 `WEBGL_lose_context` 做确定性测试。
- **对 LuxIso**：因为快照渲染器中立，整个 WebGL2 后端可在 2 秒预算内从零重建而不碰模拟——已由 lifecycle e2e 钉住。

### 7.2 纹理图集与批量约束 — WebGPU Fundamentals: Textures

<https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html>

- 采样器只在**一张绑定纹理内**过滤；把精灵打进图集才能让一次绑定画很多精灵。
- `repeat` 寻址会采到对边纹素：图集上会**渗出相邻精灵**——用 clamp-to-edge + 内缩/填充 UV。
- 图集上朴素生成 mip 会跨精灵边界渗色，需要 padding 或每精灵独立 mip；`texture_2d_array` 是更干净的替代。
- **对 LuxIso**：绘制顺序被 Kahn 关系固定，只有「顺序相邻且彼此之间无排序边」的两次绘制才能合并——永远不能跨深度冲突对；clamp-to-edge + UV padding 是必须的；120 帧闲置淘汰不能割裂一个活跃批。

### 7.3 OffscreenCanvas — MDN

<https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas>

- 可 transfer 到 worker 的画布；`transferControlToOffscreen()` 后 rAF 与 GL/2D 都在 worker 跑。
- `transferToImageBitmap()` 以所有权转移推送帧；worker 侧同样有 contextlost/restored。
- **对 LuxIso**：快照边界正是未来 worker 渲染的前提——arena 快照序列化到 worker，输入/DOM 留主线程。

---

## 8. Web 平台契约

### 8.1 devicePixelRatio — MDN

<https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio>

- DPR = 每 CSS 像素的物理像素数；成本按 **DPR²** 增长（200 CSS px 的画布在 DPR 3 下是 9 倍像素量），故业界通行 `min(dpr, 2)`。
- 缩放、跨显示器拖窗都会改变 DPR，可用 `(resolution: Ndppx)` matchMedia 监听。
- **对 LuxIso**：`maxPixelRatio = 2` 与「游戏接触的一切都是逻辑像素」契约与此一致。

### 8.2 Page Visibility API / requestAnimationFrame — MDN

<https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>
<https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>

- 后台标签/最小化/息屏触发 hidden，比 blur/focus 可靠；rAF 在后台标签被暂停。
- rAF 通常对齐刷新率（60/75/120/144Hz）；同一帧所有回调共享一个时间戳；一切运动按经过时间驱动，不按帧数。
- **对 LuxIso**：隐藏即取消 rAF + 时钟复位（空档变显式暂停而非缓慢漂移）已落地；120/144Hz 速度正确靠 dt 驱动而非每帧固定步长（ClickMover/Chest 的历史缺陷即此类）。

### 8.3 Pointer Events / touch-action — MDN/W3C

<https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events>
<https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action>

- 鼠标/笔/触摸统一模型：`pointerId`、`pointerType`、`isPrimary`；`setPointerCapture` 拖拽中绕过命中测试。
- 多点触控按 `pointerId` 跟踪触点；要处理 `pointercancel`（浏览器手势抢占）。
- `touch-action: manipulation` 消除历史上的**约 300ms 点击延迟**；`none` 同时禁止滚动/缩放手势。
- **对 LuxIso**：canvas 上 `preventDefault`/touch-action、按 identifier 维护触点表、主触点抬起提升最老存活触点，都是该契约的应用；像素坐标与 HUD 命中框同在 CSS 像素空间。

### 8.4 AudioContext — MDN

<https://developer.mozilla.org/en-US/docs/Web/API/AudioContext>

- 状态 suspended/running/closed；浏览器通常在**用户手势前保持 suspended**，在手势处理器里 `resume()`。
- 复用单一 context；`suspend()` 停硬件访问，`close()` 不可逆。
- **对 LuxIso**：构造不等于解锁；`bindPageLifecycle()` 一次性接好手势解锁 + 隐藏 suspend/回来 resume，已落地。

---

## 9. 输入抽象

### 9.1 Actions — Unity Input System

<https://docs.unity3d.com/Packages/com.unity.inputsystem@1.14/manual/Actions.html>

- InputAction 是输入的**意图**（Move/Jump），InputBinding 连接物理控件；代码只引用 action。
- action 编入具名 **InputActionMap**，整张表 enable/disable——菜单 vs 游戏的上下文模式由此表达。
- action 有独立于显示名的稳定 id；运行时重绑定是一等工作流。
- **对 LuxIso**：验证 InputMap/InputManager 分层；map 作为整体启停（上下文栈）是当前缺口（G8）。

### 9.2 InputMap — Godot 4

<https://docs.godotengine.org/en/stable/classes/class_inputmap.html>

- 全局、运行时可变的动作→事件映射；死区是**每动作**的（默认 0.2），不是每设备。
- 一个动作持有多个事件；轮询与事件两条路径都可查询。
- authored defaults（project settings）与运行时覆盖（用户改键）分层。
- **对 LuxIso**：死区配置应在语义层（per-action）；默认绑定与用户改键分层持久化（InputMap 已有 toJSON/fromJSON）。

### 9.3 Enhanced Input — Unreal Engine

<https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine>

- 严格分层管线：原始硬件 → **Modifier**（死区、取反、swizzle、缩放，可链）→ **Trigger**（点按/长按/阈值）→ Input Action → 玩法代码。
- action 有类型（bool/Axis1D/Axis2D/Axis3D）与激活相位（Started/Ongoing/Triggered/Completed/Canceled）。
- **Input Mapping Context** 带优先级压栈，运行时增删，高优先级赢得冲突。
- 输入可注入（`InjectInputForAction`）以驱动 AI/自动化。
- **对 LuxIso**：`ArenaRun.step(dt, intent)` 的 intent 就是可注入输入——同一意图路径供真人、AI 与测试使用，与 Unreal 的注入思想一致；未来 modifier 可组合化。

### 9.4 Gamepad API — W3C/MDN

<https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API>

- 状态**轮询**而非事件：每帧重新 `navigator.getGamepads()`，缓存快照会过期。
- 按钮同时有 `.pressed` 与模拟 `.value`；axes 是带漂移的原始浮点，死区是消费方责任；`standard` 映射保证 Xbox 布局。
- 按 `gamepad.index` 标识设备，槽位可为 null，热插拔是常态；需用户手势/焦点后才可见。
- **对 LuxIso**：InputManager 的逐帧原始状态轮询是正确的浏览器模型；边沿检测（pressed/released-this-frame）与热插拔在管理层，死区/归一化在 action/AxisSource 层。当前框架尚无 gamepad 轮询（G8）。

---

## 10. 存档与序列化

### 10.1 Saving games — Godot 4

<https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html>

- 第一步是**显式识别持久对象**：用 `"Persist"` group 标记，而不是序列化整个场景图。
- 每对象产出纯数据字典；引擎类型（Vector2 等）不是 JSON 可表达的，拍平为标量。
- 存档记录场景文件名与父路径；恢复 = 实例化 → 重挂载 → 赋值，**不回放事件**。
- **对 LuxIso**：SceneSerializer 注册表（显式登记的存档参与者、纯数据、`restore()` 不发 damage/death 通知）正是此模式；根记录需要 schema/version 字段（G9）。

### 10.2 JSON Canonicalization Scheme (JCS) — RFC 8785

<https://www.rfc-editor.org/rfc/rfc8785>

- 为任意 JSON 值定义唯一字节序列化：成员键按 UTF-16 码元序排序、无多余空白、数字唯一形式。
- 等价数据恒产相同字节，可哈希/签名/做 golden 快照；它只解决编码，版本迁移仍需容器承担。
- **对 LuxIso**：存档可经规范化编码器输出，使快照可哈希、round-trip 测试比字节而非比解析对象（G9）。

---

## 11. 音频引擎设计

### 11.1 PannerNode — Web Audio MDN

<https://developer.mozilla.org/en-US/docs/Web/API/PannerNode>

- `equalpower` 便宜；`HRTF` 有高度/前后辨位但每节点 CPU 更高——同时存在的 HRTF 节点要做预算。
- 衰减完全数据驱动：distanceModel（inverse 默认永不到零）、refDistance、rolloffFactor、maxDistance（是钳制不是截止）。
- 位置/朝向是 AudioParam，用 `setTargetAtTime`/ramp 平滑，避免拉链噪声；废弃的 setPosition/setOrientation 不要再用。
- 池化/复用 panner；远处/UI 声音绕过空间化。
- **对 LuxIso**：HRTF 只留给有限的重要音源；位置经 ramp 喂入；屏外淡出靠总线增益，别信 maxDistance。

### 11.2 Web Audio API Best practices — MDN

<https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices>

- 自动播放解锁是强制项；给用户静音与音量控制。
- 增益变化只用调度的 AudioParam 方法（`setValueAtTime`/ramp + `currentTime`），不与 `.value` 直写混用。
- 短 SFX 预解码 AudioBuffer + 一次性 AudioBufferSourceNode（不能重启）；长音乐走 MediaElementSource 流式。
- **对 LuxIso**：master/sfx/bgm 总线、BGM 交叉淡的请求代号防竞态、SFX 每帧声部预算（4 个/帧、同种 cue 60ms 间隔）都与这些最佳实践对齐。

---

## 12. 对象池与 GC 友好的主循环

### 12.1 Object Pool — Nystrom

<https://gameprogrammingpatterns.com/object-pool.html>

- 池化高频、短命、同质的对象（粒子、投射物、播放声）；释放只翻「在用」标志。
- 朴素获取 O(n)；**free list**（空闲槽里存链指针）让获取/释放 O(1) 且零额外内存。
- 耗尽要有显式策略：调大小、静默跳过（粒子可以）、**偷走最不引人注意的活动对象**（他的例子：最轻的声音）、或增长。
- 每个复用对象必须**完全重新初始化**——脏状态是池化的招牌缺陷；开发期可对回收槽 debug 填充。
- **对 LuxIso**：ParticleSystem 的有上限静态池（512）+ 声部限流的「偷最不明显」策略即此模式；可以加开发期脏填充来抓不完整重置。

### 12.2 托管内存优化 — Unity Manual

<https://docs.unity3d.com/Manual/performance-optimizing-code-managed-memory.html>

- 核心原则：减少 GC 触发频次——GC 停顿即使在 GC 语言里也表现为帧卡顿。
- 官方推荐用池 API 复用频繁创建的对象；逐帧热路径是独立的性能面，要审计引用类型、数组分配、闭包与反射。
- **对 LuxIso**：把「热路径零分配」提升为类似 FrameDeltaContract 的契约——每帧分配计数断言（ACCEPTANCE.md 有 ≤16KB/帧预算但目前无仪表，G10）。

---

## 13. JS/TS 引擎横向调研

| 引擎 | 架构要点 | 对 LuxIso 的取舍 |
|---|---|---|
| [Phaser 3](https://docs.phaser.io/phaser/concepts/scenes) | pause（停更新、继续渲染）/sleep（全停保状态）/shutdown（销毁可重建）三正交轴；`init→preload→create→update`；场景操作延迟到管理器下一帧；全局 Registry 做跨场景共享数据 | 「暂停可见 vs 休眠」值得低成本借鉴；跨场景共享走显式注册表而非场景静态量 |
| [PixiJS v8](https://pixijs.com/8.x/guides/migrations/v8) | 异步初始化、WebGL/WebGPU 中立渲染器；DOM/Worker adapter；剔除在渲染循环外；扩展注册表 + 子路径导入；单包注册修复 v7 重复包问题 | 渲染器是唯一异步边界；注册表要在一个包的显式 API 上，避免副作用单例 |
| [Babylon.js Observables](https://doc.babylonjs.com/features/featuresDeepDive/events/observables) | 统一 Observable 原语；20+ 生命周期钩子按文档化帧序触发；add 返回释放句柄；派发中可安全删除；帧内定时走 tick 不用 setTimeout | 受认可的事件面应收敛为带释放句柄的类型化原语；扩展点随 dispose 注销 |
| [PlayCanvas ECS](https://developer.playcanvas.com/user-manual/ecs/) | 实体是无行为身份容器（层级中）；组件加数据/能力；系统批量管理同类组件；脚本本身也是组件 | 小库学其纪律（数据组件 + 按类型查询），不搬机械：类型化 Map + 批量查询即可 |
| [Excalibur.js ECS](https://excaliburjs.com/docs/entity-component-system) · [Engine](https://excaliburjs.com/docs/engine) | 每 Scene 一个 ECS World，场景拆除即丢弃 world；系统显式优先级；Update loop 与 Draw loop 两阶段；**明确声明缓存友好内存布局不是目标** | 世界与场景 1:1 绑定；数值优先级确定顺序；不付 SoA 的代价——与 LuxIso 当前规模判断一致 |
| [Godot 4 Nodes/Scenes](https://docs.godotengine.org/en/stable/getting_started/step_by_step/nodes_and_scenes.html) | 一切是节点，组合优于深继承；保存的场景子树成为可实例化的新节点类型；group 做横切成员（也用于存档标记）；Autoload 单例刻意且稀少 | group/tag 成员查询是 instanceof 链之外的解耦方式；全局注册表要像 Autoload 一样稀少显式 |

---

## 14. 可测试性与确定性

### 14.1 Model-based testing — fast-check

<https://fast-check.dev/docs/advanced/model-based-testing/>

- 用随机命令序列对比**真实有状态系统与刻意做小的模型**；每命令有 `check(model)` 前置条件与 `run(model, real)`。
- 失败时收缩到最小命令序列，并报告 **seed + path + replayPath** 三者以复现。
- `scheduledModelRun` 还能主动搜寻异步竞态排序。
- 可运行在 Vitest/Jest 内。
- **对 LuxIso**：ArenaRun 天然适合模型测试：intent 命令对小模型（回合/波次/比分/实体 id 集合）跑纯 `step(dt, intent)`，每命令后断言不变量；把 FrameDeltaContract 从固定用例扩展到随机回放。

### 14.2 测试分层（综合各引擎实践）

- **纯逻辑层**：矩阵/投影、排序段、寻路、规则引擎（ArenaRun/WaveDirector）——无头、无浏览器、毫秒级，占绝大多数。
- **契约表**：跨模块共享契约（FrameDeltaContract）一处定义、所有消费者登记——模块级测试无法为还不存在的模块失败。
- **渲染器中立数据层**：直接量 `RenderSnapshot`（道具轮廓、提交顺序），无浏览器、无阈值——像素门禁结构上抓不到的缺陷在这里抓。
- **浏览器层**：只放浏览器才有的行为（context loss、真解码器、DPR、生命周期），数量少而贵。
- **像素 golden**：放跨平台/跨后端的视觉审批，承认它对单道具回归与绘制顺序盲区。

---

## 15. 跨资料规律对照表

| # | 多个独立来源一致指出的规律 | LuxIso 现状 | 对应设计议题 |
|---|---|---|---|
| 1 | 固定步长 + 累加器；帧时间钳制；**每帧步进数必须有显式封顶**（Fiedler、Nystrom、lockstep「4 步」） | 钳制间接封顶（实测约 7 步），无显式常量/策略 | G1 步进契约显式化 |
| 2 | 渲染按 alpha 在两个模拟状态间插值是固定步长的标准配套 | 无插值 | G2 渲染插值 |
| 3 | 查询必须缓存复用，结构变化才失效（flecs、Bevy、ecs-faq、EnTT） | 每帧 O(E×S) 重建匹配 | G3 查询缓存 |
| 4 | 迭代中结构变更经命令缓冲延迟到同步点（flecs LOCKED_STORAGE、Nystrom Update Method） | 即时增删 | G4 命令缓冲 |
| 5 | 回收 ID 带 generation，过期句柄不别名新实体（flecs） | 裸字符串 id | G5 实体句柄 |
| 6 | 事件监听随对象生命周期自动清理；payload 快照；定义排空策略（Godot、Babylon、Nystrom、Bevy） | 全局 bus、手工 off | G6 事件生命周期 |
| 7 | 更新与渲染是两个独立调度域（Godot、Excalibur、Phaser、Babylon、Fiedler） | 已分离（Scene / RenderSnapshot） | 持续保持，勿回退 |
| 8 | 后端选择走能力探测；兜底后端永远可用（WebGPU、bgfx、sokol、Pixi v8） | Canvas2D 兜底 + WebGL2 预览 | Phase 5 接线 |
| 9 | 输入是「意图」层；map/context 整体启停；可注入输入（Unity、Godot、Unreal、Gamepad API） | 有 action 层，无 context 栈、无 gamepad | G8 输入上下文 |
| 10 | 存档 = 显式标记参与者 + 纯数据 + 构造恢复不回放；带版本（Godot、JCS） | 注册表对称、restore 静默；无版本字段 | G9 存档版本/规范化 |
| 11 | 热路径零分配是独立性能面，要有度量（Unity、Nystrom 池） | 有预算行无仪表 | G10 分配计量 |
| 12 | 空间索引是主列表之上的二级缓存；格大小 > 最大交互半径（Nystrom、ecs-faq） | 2D 桶用于排序，无动态体索引 | G7 引擎级分离/分块 |
| 13 | 场景操作在边界提交、先建后切、失败可回滚（Unity 延迟激活、Phaser 延迟命令、Nystrom 状态释放规则） | replace/push/pop 已做回滚 | 补文档与异步激活 |
| 14 | 图集合批受提交顺序约束；顺序固定时只能合并无冲突相邻段（bgfx view 排序、WebGPU textures） | segment 延伸已有此规则 | 保持并写明 |
| 15 | 平台契约：DPR 钳制、后台暂停、手势解锁音频、触摸 300ms（MDN 系列） | 全部已处理 | 列入设计契约防回退 |
