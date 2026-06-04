/**
 * 数据图表页面
 * 使用 Canvas 2D 绘制传感器历史曲线
 */
const app = getApp();
const dataCache = require('../../utils/dataCache');

Page({
  data: {
    timeRange: 3600000, // 默认1小时 (ms)
    currentBattery: '--',
    currentTemp: '--',
    currentHumidity: '--',
    currentAQI: '--',
    dataCounts: { battery: 0, temperature: 0, humidity: 0, airQuality: 0 }
  },

  onShow() {
    dataCache.load();
    this._refreshCharts();
    this._updateCurrentValues();
    this._updateCounts();
  },

  onLoad() {
    // 监听 telemetry 更新
    this._watchTelemetry();
  },

  /**
   * 设置时间范围
   */
  setTimeRange(e) {
    const range = parseInt(e.currentTarget.dataset.range);
    this.setData({ timeRange: range }, () => {
      this._refreshCharts();
    });
  },

  /**
   * 监听遥测数据更新
   */
  _watchTelemetry() {
    const that = this;
    this._checkInterval = setInterval(() => {
      const telemetry = app.globalData.telemetry;
      if (telemetry) {
        let update = {};
        if (telemetry.sensors) {
          if (telemetry.sensors.temperature !== undefined) update.currentTemp = telemetry.sensors.temperature;
          if (telemetry.sensors.humidity !== undefined) update.currentHumidity = telemetry.sensors.humidity;
          if (telemetry.sensors.air_quality !== undefined) update.currentAQI = telemetry.sensors.air_quality;
        }
        if (telemetry.robot && telemetry.robot.battery !== undefined) {
          update.currentBattery = telemetry.robot.battery;
        }
        this.setData(update);
      }
      this._updateCounts();
    }, 3000);
  },

  /**
   * 更新当前值显示
   */
  _updateCurrentValues() {
    const telemetry = app.globalData.telemetry;
    if (!telemetry) return;
    this.setData({
      currentBattery: telemetry.robot?.battery ?? '--',
      currentTemp: telemetry.sensors?.temperature ?? '--',
      currentHumidity: telemetry.sensors?.humidity ?? '--',
      currentAQI: telemetry.sensors?.air_quality ?? '--'
    });
  },

  _updateCounts() {
    this.setData({ dataCounts: dataCache.getCounts() });
  },

  /**
   * 刷新所有图表
   */
  _refreshCharts() {
    const range = this.data.timeRange;

    this._drawChart('batteryChart', dataCache.getRange('battery', range), {
      color: '#3A3A3C',
      fillColor: 'rgba(28, 28, 30, 0.06)',
      label: '电量 (%)'
    });

    this._drawChart('tempChart', dataCache.getRange('temperature', range), {
      color: '#636366',
      fillColor: 'rgba(99, 99, 102, 0.06)',
      label: '温度 (℃)'
    });

    this._drawChart('humidityChart', dataCache.getRange('humidity', range), {
      color: '#8E8E93',
      fillColor: 'rgba(142, 142, 147, 0.06)',
      label: '湿度 (%)'
    });

    this._drawChart('aqiChart', dataCache.getRange('airQuality', range), {
      color: '#48484A',
      fillColor: 'rgba(72, 72, 74, 0.06)',
      label: 'AQI'
    });
  },

  /**
   * 绘制折线图 (Canvas 2D)
   */
  _drawChart(canvasId, data, opts) {
    if (!data || data.length < 2) return;

    const query = wx.createSelectorQuery();
    query.select('#' + canvasId)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        const width = res[0].width;
        const height = res[0].height;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const padding = { top: 30, right: 20, bottom: 30, left: 50 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // 清空
        ctx.clearRect(0, 0, width, height);

        // 计算范围
        const values = data.map(d => d.value);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = Math.max(maxVal - minVal, 1);
        const padding_range = range * 0.15;
        const yMin = Math.max(0, minVal - padding_range);
        const yMax = maxVal + padding_range;
        const yRange = yMax - yMin;

        // 绘制网格线
        ctx.strokeStyle = '#F0F0F3';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
          const y = padding.top + (chartH / 4) * i;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(width - padding.right, y);
          ctx.stroke();

          // 刻度标签
          const val = yMax - (yRange / 4) * i;
          ctx.fillStyle = '#C7C7CC';
          ctx.font = '18px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(val.toFixed(1), padding.left - 8, y + 6);
        }

        // 时间刻度
        const timeRange = data[data.length - 1].time - data[0].time;
        for (let i = 0; i <= 4; i++) {
          const x = padding.left + (chartW / 4) * i;
          const time = data[0].time + (timeRange / 4) * i;
          const d = new Date(time);
          const label = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
          ctx.fillStyle = '#C7C7CC';
          ctx.font = '18px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(label, x, height - 6);
        }

        // 绘制曲线
        ctx.beginPath();
        data.forEach((point, index) => {
          const x = padding.left + (index / (data.length - 1)) * chartW;
          const y = padding.top + chartH - ((point.value - yMin) / yRange) * chartH;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = opts.color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // 填充区域
        const lastIdx = data.length - 1;
        const lastX = padding.left + (lastIdx / (data.length - 1)) * chartW;
        const lastY = padding.top + chartH - ((data[lastIdx].value - yMin) / yRange) * chartH;
        ctx.lineTo(lastX, padding.top + chartH);
        ctx.lineTo(padding.left, padding.top + chartH);
        ctx.closePath();
        ctx.fillStyle = opts.fillColor || 'rgba(0,122,255,0.05)';
        ctx.fill();

        // 数据点（最后几个点）
        const showDots = data.slice(-5);
        showDots.forEach((point, idx) => {
          const globalIdx = data.length - showDots.length + idx;
          const x = padding.left + (globalIdx / (data.length - 1)) * chartW;
          const y = padding.top + chartH - ((point.value - yMin) / yRange) * chartH;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fillStyle = opts.color;
          ctx.fill();
        });
      });
  },

  /**
   * 清空缓存数据
   */
  clearData() {
    wx.showModal({
      title: '清空数据',
      content: '确定要清空所有缓存的传感器数据吗？',
      success: (res) => {
        if (res.confirm) {
          dataCache.clear();
          this._refreshCharts();
          this._updateCounts();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  onUnload() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
    }
  }
});
