const { login } = require("../../utils/auth");

Page({
  async onLoad() {
    if (!wx.cloud) {
      wx.showModal({
        title: "未开启云开发",
        content: "请在微信开发者工具中开启云开发并选择环境。",
        showCancel: false
      });
      return;
    }

    try {
      // app.js 中已经全局初始化了 wx.cloud，这里直接登录即可
      const user = await login();
      if (!user) {
        throw new Error("登录失败");
      }

      // 未注册：跳转注册页
      if (user.needRegister) {
        wx.reLaunch({ url: "/pages/register/index" });
        return;
      }
      getApp().globalData.user = user;

      // 根据角色直接进入对应主页
      const role = user.role;
      if (role === 1) {
        // 主播：进入本组线索列表（主播首页）
        wx.reLaunch({ url: "/pages/anchor/leads/index" });
      } else if (role === 2) {
        // 销售：进入我的线索列表（销售首页）
        wx.reLaunch({ url: "/pages/sales/leads/index" });
      } else if (role === 0) {
        // 管理员：进入数据看板（管理员首页）
        wx.reLaunch({ url: "/pages/admin/dashboard/index" });
      } else {
        // 兜底：仍然回首页
        wx.reLaunch({ url: "/pages/home/index" });
      }
    } catch (e) {
      wx.showModal({
        title: "登录失败",
        content: e?.message || String(e),
        showCancel: false
      });
    }
  }
});

