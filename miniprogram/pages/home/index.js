const auth = require("../../utils/auth");
const { roleName } = auth;

Page({
  data: {
    role: null,
    roleText: "",
    groupText: "",
    userName: "",
    refreshing: false
  },
  async onShow() {
    await this.refreshData();
  },
  
  async refreshData() {
    let user = getApp().globalData.user;
    if (!user) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    // 强制刷新一次用户信息，确保被管理员修改后能实时更新
    const refreshed = await require("../../utils/auth").login({ forceRefresh: true });
    if (refreshed) {
      user = refreshed;
    }
    const role = user.role;
    const groupId = user.groupId;
    this.setData({
      role,
      roleText: roleName(role),
      groupText: role === 0 ? "" : `（第${groupId}组）`,
      userName: user.name || ""
    });
  },
  
  async onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await this.refreshData();
      wx.showToast({ title: '刷新成功', icon: 'success', duration: 1000 });
    } catch (error) {
      console.error('刷新失败:', error);
      wx.showToast({ title: '刷新失败', icon: 'none' });
    } finally {
      this.setData({ refreshing: false });
    }
  },
  
  onPullDownRefresh() {
    this.onRefresh().then(() => {
      wx.stopPullDownRefresh();
    });
  },
  goAnchorLeads() {
    wx.navigateTo({ url: "/pages/anchor/leads/index" });
  },
  goSalesLeads() {
    wx.navigateTo({ url: "/pages/sales/leads/index" });
  },
  goAdmin() {
    wx.navigateTo({ url: "/pages/admin/dashboard/index" });
  },
  goProfile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
  goUsers() {
    wx.navigateTo({ url: "/pages/admin/users/index" });
  }
});

