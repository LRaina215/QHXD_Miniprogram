# 灵巡 Sentinel 微信小程序

这是灵巡 Sentinel 机器人监控小程序。当前接入目标是公网 Cloud Gateway，再由 Cloud Gateway 转发到 RK3588 后端。

## 快速启动

1. 用微信开发者工具打开本项目根目录。
2. 确认 `miniprogram/utils/config.js` 中生产环境为：

```js
BASE_URL = 'https://api.lingxunrobot.cn'
WS_STATE_URL = 'wss://api.lingxunrobot.cn/ws/state'
WS_IMU_URL = 'wss://api.lingxunrobot.cn/ws/imu'
```

3. 编译后进入首页，小程序会先通过 REST 轮询 `/api/state/latest`，再尝试连接 `/ws/state`。
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
- `GET /api/imu/latest`
- `GET /api/perception/latest_frame`
- `WSS /ws/state`

旧的 MQTT over WebSocket 客户端仍保留为 legacy 入口，但 RK3588 当前不提供 MQTT Broker，小程序不再依赖 MQTT 才能展示状态。

## 合法域名

微信公众平台需要配置：

- request 合法域名：`https://api.lingxunrobot.cn`
- socket 合法域名：`wss://api.lingxunrobot.cn`
- downloadFile 合法域名：`https://api.lingxunrobot.cn`

如果后续切换为主域名同源，也需要配置 `https://lingxunrobot.cn` 与 `wss://lingxunrobot.cn`。

## 视觉与控制边界

`/api/perception/latest_frame` 当前可能返回 404 或过期图片。小程序会显示“暂无最新检测画面”，这不影响状态、任务、告警展示。

所有任务控制均预留 Bearer Token 和二次确认。Cloud Gateway 返回 `public_control_enabled=false` 时，小程序不会误发 mission 命令。
