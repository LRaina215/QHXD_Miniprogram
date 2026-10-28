# 云拓 · 微信小程序

云拓轮腿机器人的移动端控制台，用于查看机器人位置、任务、视频和设备状态，发起找物、跟随、定点与巡检，并通过文字或语音与任务引擎交互。

小程序与 Web 共用 RK3588 后端，通过 HTTPS / WebSocket 访问云网关。任务由 RK 编排并交给 FPGA 导航与轮腿控制执行，状态沿同一业务链路返回。

[项目总览](https://github.com/LRaina215/Yuntuo/tree/main) · [总体架构](https://github.com/LRaina215/SOC_FPGA_NAV/blob/main/docs/system_architecture.md) · [维护记录](MAINTENANCE.md)

## 页面与功能

| 页面 | 功能 |
|---|---|
| 总览 | 链路与当前任务、场地图、车载视频、视觉目标、FPGA 平台数据和事件 |
| 任务 | 按类别与颜色找物、人员跟随、定点移动、巡检路线及任务时间线 |
| 助手 | 文字输入、按住说话、助手回复与运动指令确认 |
| 我的 | 访问令牌、服务地址、连接诊断、告警和运行模式 |

当前任务卡提供暂停、继续、取消与返航操作。全局停止按钮请求撤销导航运动目标并保持平衡，执行进展由后端反馈。

## 语音与视频

按住说话使用手机麦克风，通过 WechatSI 转写后将文字发送到 RK3588。文字和语音共用任务解析服务，运动类意图在确认面板中展示目标与动作。

车载视频使用 HLS，与 Web 共用云端 MediaMTX 的 `robot/front` 流。小程序通过限时播放会话获取同源地址，支持手动播放、加载提示、缓冲恢复和切页释放；连接失败时回退到检测图片。任务与导航状态通过 WebSocket 推送，REST 查询补充更新。

## 快速开始

1. 使用微信开发者工具打开仓库根目录，项目入口为 `project.config.json`，源码目录为 `miniprogram/`。
2. 在微信公众平台配置服务器域名：

   | 类型 | 域名 |
   |---|---|
   | request | `https://api.lingxunrobot.cn`、`https://lingxunrobot.cn` |
   | socket | `wss://api.lingxunrobot.cn`、`wss://lingxunrobot.cn` |
   | downloadFile | `https://api.lingxunrobot.cn`、`https://lingxunrobot.cn` |

3. 编译运行。默认服务地址为 `https://api.lingxunrobot.cn`。
4. 在“我的 → 访问 Token”填写网关访问令牌，用于助手、任务操作和连续视频会话。

局域网调试时，可在“我的 → 调试”设置 RK3588 后端地址，例如 `http://192.168.x.x:8000`。访问令牌仅保存在本机缓存中。

## 代码结构

```text
miniprogram/
  app.js / app.json / app.wxss   应用入口、页面与样式
  utils/config.js               服务地址与刷新配置
  utils/api.js                  REST 请求
  utils/socket.js               WebSocket 与重连
  utils/store.js                状态订阅与查询补充
  utils/view.js / labels.js      页面数据与中文标签
  utils/fieldMap.js              栅格、航点、轨迹和目标绘制
  utils/cameraVideo.js           视频会话、续期与故障恢复
  utils/actions.js              任务操作
  components/                   确认面板与停止按钮
  pages/                        总览、任务、助手、我的
  assets/                       品牌与界面资源
tests/                          本地测试与页面预览
```

## 后端接口

| 类别 | 接口 |
|---|---|
| 状态与导航 | `/api/state/latest`、`/api/navigation/latest`、`/ws/state`、`/ws/navigation` |
| 地图与航点 | `/api/navigation/map/metadata`、`/api/navigation/map/image`、`/api/waypoints` |
| 视觉与视频 | `/api/perception/latest_frame`、`/api/video/miniprogram/session` |
| 任务 | `/api/mission/{go_to_waypoint,start_patrol,search_target,follow_target,pause,resume,cancel,return_home}` |
| 助手与停止 | `/api/voice/smart_command`、`/api/voice/confirm_command`、`/api/platform/estop` |
| 事件与诊断 | `/api/tasks/events`、`/api/alerts`、`/api/gateway/health` |

写请求使用 Bearer Token，公网运动操作同时受网关控制开关管理。确认面板有效窗口为 30 秒，切页或更换连接后重新发起；未完成的重复请求会合并，超时后通过任务状态核对结果。

接口实现见 [RK/Web 仓库](https://github.com/LRaina215/QHXD_Web/tree/yuntuo-fpga)，视频接入见[小程序视频接口](https://github.com/LRaina215/QHXD_Web/blob/yuntuo-fpga/cloud_gateway/MINIPROGRAM_VIDEO.md)。

## 开发与测试

本地测试使用具备全局 `fetch` 和 `WebSocket` 的 Node.js 环境；维护环境为 Node 24。

```bash
node tests/static-check.js
node tests/store-lifecycle.js
node tests/camera.js
node tests/camera-video.js
node tests/command-errors.js
node tests/release-network.js
node tests/preview/render.js
```

`tests/e2e.js` 配合 RK/Web 的本机模拟服务测试任务流程；`tests/live.js` 会发出操作请求，运行前按脚本要求检查目标环境。开发约定见 [AGENTS.md](AGENTS.md)，手机测试、发布与问题记录见 [MAINTENANCE.md](MAINTENANCE.md)。

界面图标使用 [Lucide](https://lucide.dev)（ISC License）。
