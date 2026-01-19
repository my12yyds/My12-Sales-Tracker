Page({
  data: {
    phone: "",
    role: 2, // 默认销售
    name: "",
    submitting: false
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  onRoleChange(e) {
    this.setData({ role: Number(e.detail.value) });
  },

  async onSubmit() {
    const phone = String(this.data.phone || "").trim();
    const role = Number(this.data.role);
    const name = String(this.data.name || "").trim();
    if (!name) {
      wx.showToast({ title: "请输入姓名", icon: "none" });
      return;
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: "请输入正确的手机号", icon: "none" });
      return;
    }
    if (![1, 2].includes(role)) {
      wx.showToast({ title: "请选择角色", icon: "none" });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "userRegister",
        data: { phone, role, name }
      });
      if (!res?.result?.success) {
        throw new Error(res?.result?.message || "注册失败");
      }

      const user = res.result.data;
      getApp().globalData.user = user;
      try {
        wx.setStorageSync("user", user);
      } catch (e) {}

      // 注册后按角色进入主页（不分配小组）
      if (user.role === 1) {
        wx.reLaunch({ url: "/pages/anchor/leads/index" });
      } else {
        wx.reLaunch({ url: "/pages/sales/leads/index" });
      }
    } catch (e) {
      wx.showToast({ title: e?.message || "注册失败", icon: "none" });
      this.setData({ submitting: false });
    }
  }
});

