const { roleName } = require("../../utils/auth");

Page({
  data: {
    user: null,
    roleText: "",
    nameDraft: "",
    phoneDraft: "",
    wechatDraft: "",
    savingName: false,
    stats: null
  },
  async onShow() {
    let user = getApp().globalData.user;
    if (!user) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    // 强制刷新，确保管理员修改后能看到最新角色/组别/昵称
    const refreshed = await require("../../utils/auth").login({ forceRefresh: true });
    if (refreshed) {
      user = refreshed;
    }
    this.setData({
      user,
      roleText: roleName(user.role),
      nameDraft: user.name || "",
      phoneDraft: user.phone || "",
      wechatDraft: user.wechat || ""
    });
    await this.loadStats();
  },
  async loadStats() {
    try {
      const res = await wx.cloud.callFunction({ name: "userStats", data: {} });
      if (res?.result?.success) {
        this.setData({ stats: res.result.data });
      }
    } catch (e) {}
  },
  onNameInput(e) {
    this.setData({ nameDraft: e.detail.value });
  },
  onPhoneInput(e) {
    this.setData({ phoneDraft: e.detail.value });
  },
  onWechatInput(e) {
    this.setData({ wechatDraft: e.detail.value });
  },
  async saveProfile() {
    const name = (this.data.nameDraft || "").trim();
    const phone = (this.data.phoneDraft || "").trim();
    const wechat = (this.data.wechatDraft || "").trim();
    if (!name) {
      wx.showToast({ title: "请输入昵称/姓名", icon: "none" });
      return;
    }
    if (this.data.savingName) return;
    this.setData({ savingName: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "userUpdateProfile",
        data: { name, phone, wechat }
      });
      if (!res?.result?.success) {
        throw new Error(res?.result?.message || "保存失败");
      }
      const newUser = res.result.data;
      // 同步内存与缓存
      getApp().globalData.user = newUser;
      try {
        wx.setStorageSync("user", newUser);
      } catch (e) {}
      this.setData({
        user: newUser,
        nameDraft: newUser.name || "",
        phoneDraft: newUser.phone || "",
        wechatDraft: newUser.wechat || ""
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.showToast({ title: e?.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ savingName: false });
    }
  },
  goHome() {
    wx.reLaunch({ url: "/pages/home/index" });
  },
  logout() {
    wx.showModal({
      title: "确认退出",
      content: "退出后需要重新登录才能使用。",
      confirmText: "退出",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        getApp().globalData.user = null;
        try {
          wx.removeStorageSync("user");
        } catch (e) {}
        wx.reLaunch({ url: "/pages/login/index" });
      }
    });
  }
});

