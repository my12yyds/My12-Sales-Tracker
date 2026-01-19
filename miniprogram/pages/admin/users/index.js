const { login } = require("../../../utils/auth");

const ROLE_OPTIONS = [
  { label: "全部角色", value: null },
  { label: "管理员(0)", value: 0 },
  { label: "主播(1)", value: 1 },
  { label: "销售(2)", value: 2 }
];

const GROUP_OPTIONS = [
  { label: "全部小组", value: null },
  { label: "0（管理员）", value: 0 },
  { label: "第1组", value: 1 },
  { label: "第2组", value: 2 },
  { label: "第3组", value: 3 },
  { label: "第4组", value: 4 }
];

Page({
  data: {
    loading: false,
    users: [],
    roleOptions: ROLE_OPTIONS,
    groupOptions: GROUP_OPTIONS,
    roleIndex: 0,
    groupIndex: 0,
    editing: false,
    saving: false,
    editUserId: "",
    editDraft: {
      name: "",
      roleIndex: 1,
      groupIndex: 1
    },
    editRoleOptions: ROLE_OPTIONS.slice(1), // 不含“全部”
    editGroupOptions: GROUP_OPTIONS.slice(1) // 不含“全部”
  },

  onLoad() {
    this.reload();
  },

  async reload() {
    this.setData({ loading: true });
    try {
      const me = await login();
      if (!me || me.role !== 0) {
        wx.showToast({ title: "无权限", icon: "none" });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }

      const roleValue = this.data.roleOptions[this.data.roleIndex].value;
      const groupValue = this.data.groupOptions[this.data.groupIndex].value;

      const res = await wx.cloud.callFunction({
        name: "adminUserList",
        data: {
          role: roleValue === null ? undefined : roleValue,
          groupId: groupValue === null ? undefined : groupValue
        }
      });
      if (!res?.result?.success) throw new Error(res?.result?.message || "加载失败");
      this.setData({ users: res.result.data.list || [] });
    } catch (e) {
      wx.showToast({ title: e?.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onRoleFilterChange(e) {
    this.setData({ roleIndex: Number(e.detail.value) });
    this.reload();
  },

  onGroupFilterChange(e) {
    this.setData({ groupIndex: Number(e.detail.value) });
    this.reload();
  },

  openEdit(e) {
    const u = e.currentTarget.dataset.user;
    const roleIdx = this.data.editRoleOptions.findIndex((x) => x.value === u.role);
    const groupIdx = this.data.editGroupOptions.findIndex((x) => x.value === (u.groupId || 0));
    this.setData({
      editing: true,
      editUserId: u._id,
      editDraft: {
        name: u.name || "",
        roleIndex: roleIdx >= 0 ? roleIdx : 2, // 默认销售
        groupIndex: groupIdx >= 0 ? groupIdx : 1 // 默认第1组
      }
    });
  },

  closeEdit() {
    if (this.data.saving) return;
    this.setData({ editing: false, editUserId: "" });
  },

  onEditName(e) {
    this.setData({ "editDraft.name": e.detail.value });
  },

  onEditRole(e) {
    this.setData({ "editDraft.roleIndex": Number(e.detail.value) });
    // 管理员 role=0 时，自动把 group 置到 0
    const role = this.data.editRoleOptions[Number(e.detail.value)].value;
    if (role === 0) {
      const idx0 = this.data.editGroupOptions.findIndex((x) => x.value === 0);
      this.setData({ "editDraft.groupIndex": idx0 >= 0 ? idx0 : 0 });
    }
  },

  onEditGroup(e) {
    this.setData({ "editDraft.groupIndex": Number(e.detail.value) });
  },

  async saveEdit() {
    if (this.data.saving) return;
    const userId = this.data.editUserId;
    const name = (this.data.editDraft.name || "").trim();
    const role = this.data.editRoleOptions[this.data.editDraft.roleIndex].value;
    const groupId = this.data.editGroupOptions[this.data.editDraft.groupIndex].value;

    if (!name) {
      wx.showToast({ title: "昵称不能为空", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "adminUserUpdate",
        data: { userId, name, role, groupId }
      });
      if (!res?.result?.success) throw new Error(res?.result?.message || "保存失败");

      wx.showToast({ title: "已保存", icon: "success" });
      this.setData({ editing: false, editUserId: "" });
      await this.reload();
    } catch (e) {
      wx.showToast({ title: e?.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});

