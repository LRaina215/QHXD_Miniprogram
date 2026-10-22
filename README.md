# 灵巡 Sentinel 微信小程序

这是灵巡 Sentinel 机器人监控小程序。当前接入目标是公网 Cloud Gateway，再由 Cloud Gateway 转发到 RK3588 后端。

当前小程序已完成 Phase 10 F2/F3-2 的大部分移动端能力对齐：REST/WSS 主状态链路、导航地图、任务事件、视觉事件、视频健康、天气、WechatSI 语音文本化、smart assistant 和运动指令二次确认均已接入。

注意：这不代表整份 `Phase10 F3产品化扩展与演示功能完善.md` 已全部完成。完整 F3 还包括源码与部署单一真源、Web 收口、任务证据模型、巡检报告、比赛演示模式、发布/恢复文档等，这些仍需单独闭环。

## 快速启动

1. 用微信开发者工具打开本项目根目录。
2. 确认 `miniprogram/utils/config.js` 中生产环境为：

```js
BASE_URL = 'https://api.lingxunrobot.cn'
WS_STATE_URL = 'wss://api.lingxunrobot.cn/ws/state'
WS_IMU_URL = 'wss://api.lingxunrobot.cn/ws/imu'
WS_NAVIGATION_URL = 'wss://api.lingxunrobot.cn/ws/navigation'
```

3. 编译后进入首页，小程序会先通过 REST 轮询 `/api/state/latest`，再尝试连接 `/ws/state` 与 `/ws/navigation`。
4. 如需测试写接口，在设置页保存公网 Token。公网控制关闭时，任务按钮会保持保护态。

## 当前通信方式

主链路：

```text
微信小程序
  -> HTTPS / WSS
  -> api.lingxunrobot.cn
  -> Cloud Gateway
  -> RK3588 FastAPI 后端
```

当前小程序主数据源是 REST + WebSocket：

- `GET /health`
- `GET /api/state/latest`
- `GET /api/alerts`
- `GET /api/tasks/current`
- `GET /api/tasks/events`
- `GET /api/waypoints`
- `GET /api/imu/latest`
- `GET /api/commands/logs`
- `GET /api/perception/latest_frame`
- `GET /api/perception/events`
- `GET /api/perception/video_health`
- `GET /api/external/weather/latest`
- `GET /api/navigation/latest`
- `GET /api/navigation/map/metadata`
- `GET /api/navigation/map/image`
- `WSS /ws/state`
- `WSS /ws/imu`
- `WSS /ws/navigation`

旧的 MQTT over WebSocket 链路已从小程序移除。RK3588 当前不提供 MQTT Broker，后续接入以 Cloud Gateway 的 REST/WSS 为准。

## 合法域名

微信公众平台需要配置：

- request 合法域名：`https://api.lingxunrobot.cn`
- socket 合法域名：`wss://api.lingxunrobot.cn`
- downloadFile 合法域名：`https://api.lingxunrobot.cn`

如果后续切换为主域名同源，也需要配置 `https://lingxunrobot.cn` 与 `wss://lingxunrobot.cn`。

## 视觉与控制边界

`/api/perception/latest_frame` 当前作为视觉兜底图像；小程序会结合 `/api/perception/video_health` 显示 YOLO 服务、最新帧 freshness 和错误详情。视频流当前已在系统侧可用，但小程序 HLS `<video>` 播放不是本轮重点，仍保留 latest JPEG 作为可靠兜底。

所有任务控制均预留 Bearer Token 和二次确认。Cloud Gateway 返回 `public_control_enabled=false` 时，小程序不会误发 mission 命令。

## 语音与智能助手

小程序已启用微信同声传译插件。语音识别得到的文本会进入 `/api/voice/smart_command`，页面会展示识别文本、意图、解析器、TTS 状态与中文回复；运动类任务返回 `pending_command_id` 时，小程序会弹出二次确认，再调用 `/api/voice/confirm_command`。

## 当前页面能力

- 首页：展示系统模式、后端时间、IMU 姿态、视觉事件、视频健康、天气、导航地图、最近命令日志和智能助手返回结果。
- 任务页：展示当前任务、后端 waypoint、任务操作、任务事件时间线、后端任务日志和最近命令执行结果。
- 数据页：保留电量/温湿度/AQI 曲线，并补充系统模式、IMU、视觉识别、最近命令的实时快照。
- 设置页：只保留 Cloud Gateway、Token、健康检查和告警中心，不再保留 Legacy MQTT 配置。

## Phase 10 F3 完成度

已完成或基本完成：

- 小程序 REST/WSS 合法公网接入。
- `/api/waypoints`、`/api/tasks/events`、`/api/perception/events`、`/api/perception/video_health`、`/api/external/weather/latest`。
- `/api/navigation/latest`、`/api/navigation/map/metadata`、`/api/navigation/map/image` 与 `/ws/navigation`。
- 首页真实导航地图 canvas：地图底图、机器人、目标点、全局路径、局部路径；地图不可用时降级为网格示意图。
- WechatSI -> smart assistant，移动类指令继续使用后端 `pending_command_id` 二次确认。

尚未完成或未完全验收：

- 小程序 HLS `<video>` 主播放路径与前后台恢复。
- 完整 F3-0 源码/部署单一真源与可回滚发布链路。
- F3-3 `task_runs / task_events / task_artifacts` 完整证据模型。
- F3-4 基于证据的巡检报告。
- F3-5 比赛演示模式。
- F3-6 发布、监控、恢复文档拆分。

## 验收建议

- 开发者工具重新编译后确认首页、任务页、数据页、设置页都能打开。
- 真机合法域名下确认 REST、WSS、图片均可访问。
- 当前 `/api/navigation/map/metadata` 可用时，首页应显示真实地图底图；当 `/api/navigation/latest` 的 `pose/goal/path` 为空时，只显示地图，不显示机器人/路径是正常状态。
- 无 Token 时查询类 smart assistant 不应被阻止；控制类操作必须 Token + `public_control_enabled=true` + 二次确认。
