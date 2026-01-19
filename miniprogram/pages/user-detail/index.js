function formatDateOnly(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function roleName(role) {
  if (role === 0) return "管理员";
  if (role === 1) return "主播";
  if (role === 2) return "销售";
  return "未知";
}

Page({
  data: {
    userId: '',
    user: null,
    loading: false,
    currentUser: null
  },

  onLoad(options) {
    const { userId } = options;
    if (!userId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ userId });
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      // 使用全局用户信息，避免导入 auth 模块
      const app = getApp();
      let currentUser = app.globalData.user;
      
      // 如果没有全局用户信息，尝试从缓存读取
      if (!currentUser) {
        try {
          currentUser = wx.getStorageSync("user");
          if (currentUser && currentUser.openid) {
            app.globalData.user = currentUser;
          }
        } catch (e) {}
      }
      
      // 如果还是没有，调用云函数登录
      if (!currentUser) {
        const loginRes = await wx.cloud.callFunction({ name: "authLogin", data: {} });
        if (loginRes?.result?.success && !loginRes?.result?.needRegister) {
          currentUser = loginRes.result.data;
          app.globalData.user = currentUser;
          try {
            wx.setStorageSync("user", currentUser);
          } catch (e) {}
        } else {
          wx.redirectTo({ url: '/pages/login/index' });
          return;
        }
      }

      if (!currentUser) {
        wx.redirectTo({ url: '/pages/login/index' });
        return;
      }

      const res = await wx.cloud.callFunction({
        name: 'userDetail',
        data: {
          userId: this.data.userId
        }
      });

      if (res.result.success) {
        const user = res.result.data;
        // 权限检查：只有管理员或本人可以看到手机号和微信号
        const isAdmin = currentUser.role === 0;
        const isSelf = currentUser._id === this.data.userId;
        const canSeePrivate = isAdmin || isSelf;
        
        this.setData({
          user: {
            ...user,
            createdAtDate: user.createdAt ? formatDateOnly(user.createdAt) : '',
            roleText: roleName(user.role),
            groupText: user.groupId > 0 ? `第${user.groupId}组` : '未分配',
            canSeePrivate: canSeePrivate // 前端权限标记
          },
          currentUser,
          loading: false
        });
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    } catch (error) {
      console.error('加载用户详情失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onFollowUpTap() {
    const { user, currentUser } = this.data;
    if (!user) return;
    
    // 根据用户角色跳转到对应的线索列表页面
    if (user.role === 1) {
      // 主播：跳转到主播线索列表
      wx.navigateTo({ url: '/pages/anchor/leads/index' });
    } else if (user.role === 2) {
      // 销售：跳转到销售线索列表
      wx.navigateTo({ url: '/pages/sales/leads/index' });
    }
  }
});
