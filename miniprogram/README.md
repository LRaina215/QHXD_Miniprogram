# 云拓小程序源码

总体说明、合法域名、接口与测试见仓库根目录 `README.md`。这里只记开发约定。

- 数据统一从 `utils/store.js` 取：页面 `require('../../utils/store')` 后 `store.on('state' | 'nav' | 'conn' | ...)` 订阅，
  返回值是取消订阅函数，在 `onUnload` / `detached` 里调用。不要在模块顶层用 `getApp().store`。
- 页面里的展示文案和状态色在 `utils/view.js`、`utils/labels.js` 里算好，WXML 只做绑定。
- 状态色只用 `ok / run / wait / warn / bad / off / mock` 这几档（`.tag.<tone>`），品牌蓝只给主操作和当前态。
- 运动类指令一律经过 `confirm-sheet` 确认（`utils/actions.js` 生成确认内容）；急停按下不确认，解除要确认。
- 组件开启 `addGlobalClass`，组件内样式加前缀（`cs-`、`ef-`）避免和全局类重名。
- 新增图片后跑 `node tests/static-check.js`，它会检查所有静态和已知动态图片路径。
