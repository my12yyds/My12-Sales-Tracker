App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    // 全局初始化云能力，绑定到你提供的云环境 ID
    wx.cloud.init({
      env: "cloud1-6gabl16ha21ae673",
      traceUser: true
    });
  },
  globalData: {
    user: null
  }
});

