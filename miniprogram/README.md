# 灵巡 Sentinel - 机器人监控微信小程序

基于微信小程序原生开发的 RK3588 机器人监控与控制客户端。

当前状态：小程序已完成 Phase 10 F2/F3-2 的主要移动端能力对齐，但完整 F3 产品化阶段尚未全部完成。已完成的重点是公网 REST/WSS、smart assistant、任务控制、任务事件、视觉事件、视频健康、天气和真实导航地图展示；未完成的重点是小程序 HLS 主视频、巡检报告、演示模式、发布/恢复文档和完整证据模型。

## 当前接入链路

主链路为 REST + WebSocket：

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
- `WS_NAVIGATION_URL`
- `ROBOT_ID`
- `POLL_INTERVAL_MS`
- `PUBLIC_API_TOKEN_PLACEHOLDER`

## 功能

### 已接入

- 首页展示 Cloud Gateway、RK3588、REST/WSS、状态过期、公网控制状态
- REST 轮询 `/api/state/latest`，默认 3 秒刷新，并避免 RK 下线时堆叠请求
- WebSocket 连接 `/ws/state` 与 `/ws/navigation`，失败时自动降级 REST 轮询
- 后端字段由 `utils/stateAdapter.js` 统一适配到页面结构
- 温度、湿度、电量、急停、导航状态、当前任务、告警列表展示
- IMU、视觉识别事件、系统模式、后端时间、命令日志在首页/任务页/数据页中展示
- 视觉图片使用 `/api/perception/latest_frame?t=...`，并结合 `/api/perception/video_health` 显示 YOLO、最新帧和错误详情
- 首页展示持久化 `/api/perception/events`，刷新后仍可看到最近视觉事件
- 首页展示 Open-Meteo 天气卡片，并保留 smart assistant 天气问答
- 任务页展示 `/api/tasks/events` 任务事件时间线
- 导航状态读取 `/api/navigation/latest`，`/ws/navigation` 可用时作为实时更新通道
- 首页导航卡片读取 `/api/navigation/map/metadata` 与 `/api/navigation/map/image`，在 canvas 上叠加机器人、目标点、全局路径和局部路径；地图不可用时降级为网格示意图
- 任务控制走 `utils/commandClient.js`，需要公网 Token 和二次确认
- 微信同声传译识别文本接入 `/api/voice/smart_command`
- 已移除 MQTT 客户端，当前只维护 REST + WebSocket 主链路

### 暂未完全完成

- 小程序 HLS `<video>` 主路径播放与前后台恢复；当前仍以 latest JPEG 为可靠兜底。
- 巡检报告入口、报告详情、TTS 短摘要。
- 比赛演示模式、预检步骤、失败回退引导。
- 完整调试/排障页：Token 状态、WS 状态、video health detail、最近 smart command 错误等还未系统化整理。
- F3-0 要求的源码真源、发布、回滚和版本冻结不属于小程序代码功能本身，仍需单独完成。

## 主要工具文件

```text
utils/config.js             公网地址与运行参数
utils/api.js                wx.request REST 客户端
utils/stateAdapter.js       RK3588 状态字段适配
utils/wsClient.js           /ws/state WebSocket 客户端
utils/navigationWsClient.js /ws/navigation WebSocket 客户端
utils/navigationMap.js      导航地图 metadata 与坐标转换
utils/commandClient.js      mission/voice 写接口客户端
```

## 后端接口

读取接口：

```text
GET /health
GET /api/state/latest
GET /api/alerts
GET /api/tasks/current
GET /api/tasks/events
GET /api/waypoints
GET /api/imu/latest
GET /api/commands/logs
GET /api/perception/latest_frame
GET /api/perception/events
GET /api/perception/video_health
GET /api/external/weather/latest
GET /api/navigation/latest
GET /api/navigation/map/metadata
GET /api/navigation/map/image
WSS /ws/state
WSS /ws/imu
WSS /ws/navigation
```

写接口：

```text
POST /api/mission/go_to_waypoint
POST /api/mission/start_patrol
POST /api/mission/pause
POST /api/mission/resume
POST /api/mission/return_home
POST /api/mission/cancel
POST /api/voice/smart_command
POST /api/voice/confirm_command
```

写接口需要：

```text
Authorization: Bearer <PUBLIC_API_TOKEN>
```

并且 Cloud Gateway 的 `public_control_enabled` 必须允许对应控制。

## 页面说明

### 首页

- 运行驾驶舱：Cloud、RK3588、主状态链路、控制开关、电量、当前任务、目标/距离、风险状态。
- Smart Command：文本输入、WechatSI 语音识别、快捷问句、智能助手回复、运动指令确认卡。
- 视觉：latest JPEG、YOLO 运行状态、最新帧 freshness、`/api/perception/video_health` 详情。
- 最近视觉事件：优先读取 `/api/perception/events`，页面刷新后仍可展示历史事件。
- 天气：读取 Open-Meteo 实时天气，展示地点、气温、体感、湿度、降雨概率、紫外线和出行建议。
- 导航：读取 `/api/navigation/map/metadata`、`/api/navigation/map/image` 和 `/api/navigation/latest`，在 canvas 上叠加地图、机器人、目标点、全局路径和局部路径。

导航地图降级规则：

- metadata 与图片都可用：显示真实地图底图。
- navigation `pose/goal/path` 为空：只显示地图底图和文字导航状态，这是 `nav_state=waiting` 时的正常状态。
- metadata 或图片不可用：显示网格示意图，不阻塞其他页面功能。

### 任务页

- 读取 `/api/waypoints` 渲染目标点按钮，不在页面写死点位坐标。
- 支持巡检、目标点、暂停、恢复、返航、取消。
- 所有运动控制需要公网 Token、`public_control_enabled=true` 和二次确认。
- 展示 `/api/tasks/events` 任务事件时间线，包括 started、feedback、completed、failed、cancelled 等事件。

### 数据页

- 保留本地短时曲线与传感器快照。
- 展示 IMU、视觉识别、命令日志等实时状态补充信息。
- 不把天气数据冒充为本体环境传感器。

### 设置页

- 保存公网 Token。
- 执行健康检查、模式切换和告警查看。
- Legacy MQTT 已移除。

## 合法域名

微信公众平台配置：

```text
request:      https://api.lingxunrobot.cn
socket:       wss://api.lingxunrobot.cn
downloadFile: https://api.lingxunrobot.cn
```

真机如 WebSocket 不稳定，小程序会继续使用 REST 轮询。

## 语音输入

`app.json` 已声明 WechatSI 插件。点击首页麦克风后，小程序调用微信同声传译得到文本，再提交到 RK3588 智能助手接口。查询类会直接展示回复；运动类会保留后端 pending id 并要求二次确认。

查询类问题不应因为没有 Token 而被误拦截；控制类任务必须受 Token、控制开关、在线状态和二次确认保护。

## Phase 10 F3 对照

### 小程序侧已完成

- `GET /api/waypoints`。
- `/ws/navigation` 独立客户端，失败不影响 `/ws/state`。
- `/api/navigation/latest`、`/api/navigation/map/metadata`、`/api/navigation/map/image`。
- 首页真实导航地图 canvas 展示与降级。
- `/api/tasks/events` 任务事件时间线。
- `/api/perception/events` 持久化视觉事件。
- `/api/perception/video_health` 视频健康详情。
- `/api/external/weather/latest` 天气卡片。
- WechatSI -> `/api/voice/smart_command`。
- 后端 pending id 二次确认。

### 仍未完成

- 小程序 HLS `<video>` 播放和 latest JPEG 自动回退切换。
- 小程序完整排障页/演示调试页。
- 巡检报告入口与报告详情页。
- 比赛演示模式。
- 与 Web 同步的完整报告、证据、历史分页能力。

### 不属于小程序单独完成范围

- Web 真源、云端部署产物、RK QHXD 副本之间的单一真源治理。
- `task_runs/task_artifacts` 数据库模型。
- 巡检报告生成服务。
- 发布、回滚、监控与恢复文档拆分。

## 当前验收方式

静态检查：

```bash
find miniprogram -name '*.js' -print0 | xargs -0 -n1 node --check
node -e "JSON.parse(require('fs').readFileSync('project.config.json','utf8')); JSON.parse(require('fs').readFileSync('project.private.config.json','utf8')); JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8')); console.log('json ok')"
```

公网只读接口抽查：

```bash
curl --noproxy '*' https://api.lingxunrobot.cn/health
curl --noproxy '*' https://api.lingxunrobot.cn/api/navigation/map/metadata
curl --noproxy '*' https://api.lingxunrobot.cn/api/navigation/latest
curl --noproxy '*' https://api.lingxunrobot.cn/api/perception/video_health
curl --noproxy '*' 'https://api.lingxunrobot.cn/api/perception/events?limit=5'
curl --noproxy '*' https://api.lingxunrobot.cn/api/external/weather/latest
curl --noproxy '*' 'https://api.lingxunrobot.cn/api/tasks/events?limit=10'
```

真机/开发者工具验收：

- 首页能显示 Cloud/RK/控制状态。
- 首页 smart assistant 查询类问题可直接返回文本。
- 运动类语音或任务按钮出现二次确认。
- 首页导航卡片能显示真实地图；当 `/api/navigation/latest` 里 `pose` 为空时，不显示机器人是正常状态。
- 任务页目标点来自后端 waypoints。
- 任务页能显示最近任务事件。
- 设置页 Token 不明文展示在日志或文档中。
