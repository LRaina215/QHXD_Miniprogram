# 云拓 · 微信小程序

云拓（多模态复杂地形轮腿机器人）的移动端控制台。和 Web 控制台共用同一套后端契约与设计语言：
看机器人在哪、在做什么、FPGA 平台是否正常，下发视觉任务 / 定点 / 巡检，用语音或文字指挥，随时急停。

当前接手状态、验证范围与遗留事项见 [MAINTENANCE.md](MAINTENANCE.md)；后续开发约定见 [AGENTS.md](AGENTS.md)。

```text
微信小程序 ──HTTPS / WSS──> lingxunrobot.cn（nginx：/api/ 与 /ws/）
          ──> Cloud Gateway ──> RK3588 FastAPI

仅执行导航 / 控制任务时，后端继续下发：
RK3588 FastAPI ──> fpga_bridge ──> FPGA（当前未接板时使用 mock）
```

小程序只通过网关访问 RK3588 后端接口，不直接连接 FPGA。助手解析、相机感知和业务接口由 RK3588 处理；FPGA 是运动任务的下游执行与反馈端。后端的“实车模式”也可以配合 mock FPGA 调试，不能据此判断已接真实板卡。

## 快速开始

1. 微信开发者工具打开仓库根目录（`miniprogramRoot` 为 `miniprogram/`，AppID 见 `project.config.json`）。
2. 微信公众平台 → 开发管理 → 服务器域名，配置：

   | 类型 | 域名 |
   | --- | --- |
   | request | `https://lingxunrobot.cn` |
   | socket | `wss://lingxunrobot.cn` |
   | downloadFile | `https://lingxunrobot.cn` |

   统一用主域名，不再配 `api.lingxunrobot.cn`：只维护一个合法域名和一张证书（主域名证书 2026-12-27 到期）。
3. 编译运行。总览、地图、相机、事件这些只读内容不需要 Token。
4. 助手对话、下发任务、急停都是 POST，网关要求 Token：在「我的 → 访问 Token」里填入公网 Token
   （与 Cloud Gateway 的 `PUBLIC_API_TOKEN` 一致）。Token 只存在本机缓存，不要写进代码或文档。

调试时可在「我的 → 调试」把服务地址改成局域网 RK3588（如 `http://192.168.x.x:8000`），
需要在开发者工具里勾选「不校验合法域名」。清空即恢复 `https://lingxunrobot.cn`。

## 页面

| Tab | 内容 |
| --- | --- |
| 总览 | 链路状态（网关 / RK3588 / 实时推送 / FPGA）、当前任务卡（暂停 / 继续 / 取消 / 返航）、场地图与相机画面、FPGA 平台数据、视觉目标、最近事件 |
| 任务 | 视觉任务（选类别 + 颜色：寻找并停在旁边 / 跟随我）、定点前往、巡检路线、任务事件时间线 |
| 助手 | 按住说话（微信同声传译）或文字输入 → 智能助手；运动类指令弹出确认后才执行 |
| 我的 | 连接诊断、控制令牌、模拟 / 实车模式切换、告警、调试地址 |

全局组件：`estop-fab`（右下角急停，按下立即生效，解除需确认）、`confirm-sheet`（运动指令确认底板）。

## 代码结构

```text
miniprogram/
  app.js / app.json / app.wxss   入口、tabBar、设计令牌（与 Web 控制台同一套）
  utils/config.js                服务地址、Token 缓存键、刷新周期
  utils/api.js                   REST 客户端，网关拒绝原因翻译成中文
  utils/socket.js                带心跳与退避重连的 WebSocket
  utils/store.js                 全局数据仓库：WS 优先，断线或过期时 REST 兜底
  utils/view.js / labels.js      页面视图模型与中文标签
  utils/fieldMap.js              Canvas 2D 场地图（栅格、航点、轨迹、目标、机器人视野）
  utils/actions.js               运动指令确认内容与执行
  components/                    confirm-sheet、estop-fab
  pages/                         home、mission、assistant、me
  assets/                        品牌图、tab 与功能图标
tests/                           本地模拟测试（不打包进小程序）
```

## 后端接口

读：`/api/state/latest`、`/api/navigation/latest`、`/api/navigation/map/metadata`、`/api/navigation/map/image`、
`/api/waypoints`、`/api/tasks/events`、`/api/alerts`、`/api/perception/latest_frame`、`/api/gateway/health`，
实时：`/ws/state`、`/ws/navigation`。

写（需 `Authorization: Bearer <Token>`）：`/api/mission/{go_to_waypoint, start_patrol, search_target, follow_target, pause, resume, cancel, return_home}`、
`/api/platform/estop`、`/api/voice/smart_command`、`/api/voice/confirm_command`、`/api/system/mode/switch`。

运动类指令还要求网关开启公网控制（`PUBLIC_CONTROL_ENABLED`）。网关返回的拒绝原因会直接显示给用户。

依赖新版 Cloud Gateway（QHXD_Web `yuntuo-fpga` 分支）的两处：
- `/api/gateway/health`：主域名只转发 `/api/`，网关健康要从这里取；旧网关上会回退到 `/health`，「公网运动控制」显示为未知。
- `/api/platform/estop`：旧网关白名单没有它，急停会回退为取消当前任务。

## 测试

测试运行时需要提供全局 `fetch` 和 `WebSocket`。本次维护使用 Node 24.20.0；低版本 Node 不一定具备这两项，不依赖微信开发者工具。

```bash
node tests/static-check.js           # JSON、页面文件、WXML 配对、事件方法、图片资源
node tests/live-safety.js            # 公网测试的失败收尾保护；纯本地模拟，不连接设备
node tests/store-lifecycle.js        # 服务器切换、迟到响应与离线状态；纯本地模拟
node tests/camera.js                 # 图片错误解析、过期提示与相机轮询隔离；纯本地模拟
node tests/smoke.js [地址]             # 只读冒烟，默认 https://lingxunrobot.cn，可随时对线上跑
node tests/e2e.js [后端地址]          # 默认 http://127.0.0.1:8000，会下发运动指令，只对本机模拟链路跑
YUNTUO_TOKEN=... node tests/live.js  # 公网控制链路：板载大模型助手、确认 / 取消、暂停继续、急停；仅 FPGA 为 mock 且空闲时运行
node tests/preview/render.js         # 生成 tests/preview/out/*.html 版式预览
```

`e2e.js` 用 `tests/wx-sim.js` 模拟 wx 运行时，跑真实的页面逻辑；后端用 QHXD_Web 的
`scripts/start_yuntuo_sim.sh` 起本机模拟链路（backend + fpga_bridge + mock_fpga，实车模式，Token `local-test-token`）。
覆盖：实时推送 → 总览渲染 → 语音「找到红色水瓶」确认执行到完成 → 定点 → 按住说话「暂停」→ 取消 → 急停与解除。

预览渲染器只支持本项目用到的 WXML 子集，用于检查版式，不能替代开发者工具和真机验收。

## 其他

- `cloudfunctions/quickstartFunctions` 是开发者工具模板留下的云函数，小程序未调用。
- 图标来自 [Lucide](https://lucide.dev)（ISC License）。
