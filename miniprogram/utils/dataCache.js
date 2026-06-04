/**
 * 数据缓存工具
 * 缓存传感器历史数据，用于图表展示
 */

const MAX_POINTS = 200;
const STORAGE_KEY = 'sentinel_history_data';

class DataCache {
  constructor() {
    this.data = this._defaultData();
  }

  _defaultData() {
    return {
      battery: [],
      co: [],
      ch4: [],
      airQuality: [],
      temperature: [],
      humidity: []
    };
  }

  /**
   * 从本地存储加载数据
   */
  load() {
    try {
      const saved = wx.getStorageSync(STORAGE_KEY);
      if (saved) {
        this.data = Object.assign(this._defaultData(), saved);
      }
    } catch (e) {
      console.warn('[DataCache] 读取缓存失败:', e);
    }
    return this;
  }

  /**
   * 保存数据到本地存储
   */
  save() {
    try {
      wx.setStorageSync(STORAGE_KEY, this.data);
    } catch (e) {
      console.warn('[DataCache] 保存缓存失败:', e);
    }
  }

  /**
   * 添加数据点
   */
  push(type, value) {
    if (!this.data[type]) {
      this.data[type] = [];
    }
    const point = {
      time: Date.now(),
      value: value
    };
    this.data[type].push(point);
    if (this.data[type].length > MAX_POINTS) {
      this.data[type].shift();
    }
    return point;
  }

  /**
   * 批量添加数据
   */
  updateFromTelemetry(telemetry) {
    if (!telemetry) return;

    const timestamp = Date.now();

    if (telemetry.robot && telemetry.robot.battery !== undefined) {
      this.data.battery.push({ time: timestamp, value: telemetry.robot.battery });
      if (this.data.battery.length > MAX_POINTS) this.data.battery.shift();
    }
    if (telemetry.sensors && telemetry.sensors.co !== undefined && telemetry.sensors.co !== null) {
      this.data.co.push({ time: timestamp, value: telemetry.sensors.co });
      if (this.data.co.length > MAX_POINTS) this.data.co.shift();
    }
    if (telemetry.sensors && telemetry.sensors.ch4 !== undefined && telemetry.sensors.ch4 !== null) {
      this.data.ch4.push({ time: timestamp, value: telemetry.sensors.ch4 });
      if (this.data.ch4.length > MAX_POINTS) this.data.ch4.shift();
    }
    if (telemetry.sensors && telemetry.sensors.air_quality !== undefined && telemetry.sensors.air_quality !== null) {
      this.data.airQuality.push({ time: timestamp, value: telemetry.sensors.air_quality });
      if (this.data.airQuality.length > MAX_POINTS) this.data.airQuality.shift();
    }
    if (telemetry.sensors && telemetry.sensors.temperature !== undefined && telemetry.sensors.temperature !== null) {
      this.data.temperature.push({ time: timestamp, value: telemetry.sensors.temperature });
      if (this.data.temperature.length > MAX_POINTS) this.data.temperature.shift();
    }
    if (telemetry.sensors && telemetry.sensors.humidity !== undefined && telemetry.sensors.humidity !== null) {
      this.data.humidity.push({ time: timestamp, value: telemetry.sensors.humidity });
      if (this.data.humidity.length > MAX_POINTS) this.data.humidity.shift();
    }

    // 每10次保存一次
    this._saveCount = (this._saveCount || 0) + 1;
    if (this._saveCount % 10 === 0) {
      this.save();
    }
  }

  /**
   * 获取指定时间范围内的数据
   */
  getRange(type, duration) {
    const now = Date.now();
    const since = now - duration;
    return (this.data[type] || []).filter(p => p.time >= since);
  }

  /**
   * 获取最近N个数据点
   */
  getLast(type, count = 50) {
    const arr = this.data[type] || [];
    return arr.slice(-count);
  }

  /**
   * 获取所有数据
   */
  getAll() {
    return this.data;
  }

  /**
   * 清空数据
   */
  clear() {
    this.data = this._defaultData();
    this.save();
  }

  /**
   * 数据的数量统计
   */
  getCounts() {
    return {
      battery: this.data.battery.length,
      co: this.data.co.length,
      ch4: this.data.ch4.length,
      airQuality: this.data.airQuality.length,
      temperature: this.data.temperature.length,
      humidity: this.data.humidity.length
    };
  }
}

module.exports = new DataCache();
