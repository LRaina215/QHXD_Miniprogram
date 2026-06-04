# 灵巡 Sentinel - 机器人监控微信小程序

基于微信小程序原生开发的 RK3588 机器人监控与控制客户端。

## 当前接入链路

Phase 8C 后，主链路为 REST + WebSocket：

```text
miniprogram
  -> https://api.lingxunrobot.cn
  -> Cloud Gateway
  -> RK3588 FastAPI backend
```

关键配置集中在 `utils/config.js`：

- `BASE_URL`
- `WS_STATE_URL`
- `WS_IMU_URL`
- `ROBOT_ID`
- `POLL_INTERVAL_MS`
- `PUBLIC_API_TOKEN_PLACEHOLDER`

## 功能

- 首页展示 Cloud Gateway、RK3588、REST/WSS、状态过期、公网控制状态
- REST 轮询 `/api/state/latest`，默认 1 秒刷新
- WebSocket 连接 `/ws/state`，失败时自动降级 REST 轮询
- 后端字段由 `utils/stateAdapter.js` 统一适配到页面结构
- 温度、湿度、电量、急停、导航状态、当前任务、告警列表展示
- 视觉图片使用 `/api/perception/latest_frame?t=...`，404 时显示占位
- 任务控制走 `utils/commandClient.js`，需要公网 Token 和二次确认
- MQTT 客户端保留为 legacy 备用，不再作为主数据源

## 主要工具文件

```text
utils/config.js        公网地址与运行参数
utils/api.js           wx.request REST 客户端
utils/stateAdapter.js  RK3588 状态字段适配
utils/wsClient.js      /ws/state WebSocket 客户端
utils/commandClient.js mission/voice 写接口客户端
utils/mqtt.js          legacy MQTT 备用客户端
```

## 后端接口

读取接口：

```text
GET /health
GET /api/state/latest
GET /api/alerts
GET /api/tasks/current
GET /api/imu/latest
GET /api/perception/latest_frame
```

写接口：

```text
POST /api/mission/go_to_waypoint
POST /api/mission/start_patrol
POST /api/mission/pause
POST /api/mission/resume
POST /api/mission/return_home
POST /api/voice/smart_command
POST /api/voice/confirm_command
```

写接口需要：

```text
Authorization: Bearer <PUBLIC_API_TOKEN>
```

并且 Cloud Gateway 的 `public_control_enabled` 必须允许对应控制。

## 合法域名

微信公众平台配置：

```text
request:      https://api.lingxunrobot.cn
socket:       wss://api.lingxunrobot.cn
downloadFile: https://api.lingxunrobot.cn
```

真机如 WebSocket 不稳定，小程序会继续使用 REST 轮询。
