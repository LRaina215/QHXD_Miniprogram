/** 仅在本地模拟 live.js 的失败路径，不连接网络，不下发设备指令。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');

async function runFailure(options) {
  let active = !!options.active;
  let estopped = !!options.estopped;
  const writes = [];
  const errors = [];
  const socket = {
    connected: true,
    on() { if (options.setupError) throw new Error('连接初始化失败'); }
  };
  const store = {
    conn: { rk: true }, state: {}, waypoints: [{}],
    stateSocket: socket, navSocket: socket,
    platform: () => ({ nav_link: options.nav || 'mock', control_link: options.control || 'mock' }),
    taskActive: () => active,
    task: () => ({ task_id: 'existing-task' }),
    estopActive: () => estopped,
    stop() {}
  };
  const wxSim = {
    wx: { request() { throw new Error('不应发起网络请求'); } },
    sim: {}, storage: new Map(), log: { toasts: [] },
    startApp() {},
    mount() {
      // 模拟所有前置检查通过后，测试中产生任务、急停并发生异常。
      active = true;
      estopped = true;
      throw new Error('测试中途失败');
    }
  };
  let exit;
  const exited = new Promise((resolve) => { exit = resolve; });
  const sandbox = {
    require(name) {
      if (name === 'assert') return assert;
      if (name === './wx-sim') return wxSim;
      if (name === '../miniprogram/utils/store') return store;
      if (name === '../miniprogram/utils/actions') return { run: async (command) => writes.push(command) };
      if (name === '../miniprogram/utils/api') return { estop: async (engage) => writes.push('estop:' + engage) };
      throw new Error('未模拟的模块：' + name);
    },
    process: {
      argv: ['node', 'live.js', 'https://local-test.invalid'],
      env: { YUNTUO_TOKEN: 'local-dummy-token' },
      exit: (code) => exit(code)
    },
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    setTimeout() { throw new Error('失败路径不应等待网络'); }
  };
  vm.runInNewContext(source, sandbox, { filename: 'live.js' });
  const code = await exited;
  assert.strictEqual(code, 1, '应以失败状态退出');
  assert.ok(errors.some((line) => line.includes(options.error)), errors.join('\n'));
  assert.deepStrictEqual(writes, options.writes || [], '失败收尾不应操作前置检查未通过的设备');
}

(async () => {
  const cases = [
    { name: '真实链路已有任务和急停', nav: 'serial', control: 'serial', active: true, estopped: true, error: 'FPGA 不是模拟链路' },
    { name: '控制侧仍是真实链路', control: 'serial', active: true, error: 'FPGA 不是模拟链路' },
    { name: '模拟链路已有任务', active: true, error: '当前有任务在执行' },
    { name: '模拟链路已有急停', estopped: true, error: '当前处于急停' },
    { name: '初始化失败', setupError: true, active: true, estopped: true, error: '连接初始化失败' },
    { name: '检查通过后仍能收尾', error: '测试中途失败', writes: ['estop:false', 'cancel'] }
  ];
  for (const test of cases) {
    await runFailure(test);
    console.log('  ✓ ' + test.name);
  }
  console.log('公网测试前置保护检查通过（纯本地模拟）');
})().catch((error) => { console.error(error); process.exitCode = 1; });
