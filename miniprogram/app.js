App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    // 全局初始化云能力，绑定到你提供的云环境 ID
    wx.cloud.init({
      env: "YOUR_CLOUD_ENV_ID", // 替换为你的云环境ID
      traceUser: true
    });
  },
  globalData: {
    user: null
  }
});

