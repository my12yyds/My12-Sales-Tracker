const auth = require('../../../utils/auth');
const { login } = auth;

Page({
  data: {
    summary: null,
    groupStats: [],
    loading: false,
    userName: ''
  },

  onLoad() {
    this.loadDashboard();
  },

  goUsers() {
    wx.navigateTo({ url: "/pages/admin/users/index" });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  goGroupLeads(e) {
    const groupId = e.currentTarget.dataset.group;
    wx.navigateTo({
      url: `/pages/admin/group-leads/index?groupId=${groupId}`
    });
  },

  goUserDetail(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId) return;
    wx.navigateTo({
      url: `/pages/user-detail/index?userId=${userId}`
    });
  },

  onRefresh() {
    this.loadDashboard();
  },
  
  onPullDownRefresh() {
    this.loadDashboard().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  goLeadDetail(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/lead-detail/index?leadId=${id}`
    });
  },

  onDeleteLead(e) {
    const leadId = e.currentTarget.dataset.id;
    if (!leadId) return;
    
    const that = this;
    wx.showModal({
      title: '确认删除',
      content: '删除后将无法恢复，确定要删除这条线索吗？',
      success: async function(res) {
        if (res.confirm) {
          await that.deleteLead(leadId);
        }
      }
    });
  },

  async deleteLead(leadId) {
    wx.showLoading({ title: '删除中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'leadDelete',
        data: {
          leadId: leadId
        }
      });

      wx.hideLoading();

      if (res.result.success) {
        wx.showToast({ title: '删除成功', icon: 'success' });
        this.loadDashboard();
      } else {
        wx.showToast({ title: res.result.message || '删除失败', icon: 'none' });
      }
    } catch (error) {
      wx.hideLoading();
      console.error('删除线索失败:', error);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  async loadDashboard() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    try {
      const user = await login();
      if (!user || user.role !== 0) {
        wx.showToast({ title: '无权限', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return Promise.reject(new Error('无权限'));
      }

      // 显示当前登录账号姓名
      this.setData({
        userName: user.name || ''
      });

      const res = await wx.cloud.callFunction({
        name: 'adminDashboard',
        data: {}
      });

      if (res.result.success) {
        const { formatDateOnly } = require('../../../utils/date');
        const { getStatusText } = require('../../../utils/status');
        const groupStats = (res.result.data.groupStats || []).map(group => ({
          ...group,
          leads: (group.leads || []).map(lead => ({
            ...lead,
            createdAtDate: lead.createdAt ? formatDateOnly(lead.createdAt) : '',
            lastStatusText: getStatusText(lead.lastStatus)
          }))
        }));
        this.setData({
          summary: res.result.data.summary,
          groupStats: groupStats,
          loading: false
        });
        return Promise.resolve();
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
        this.setData({ loading: false });
        return Promise.reject(new Error(res.result.message || '加载失败'));
      }
    } catch (error) {
      console.error('加载看板失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return Promise.reject(error);
    }
  }
});
