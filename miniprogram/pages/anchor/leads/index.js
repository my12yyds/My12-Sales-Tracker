const auth = require('../../../utils/auth');
const { login } = auth;
const { formatDateOnly } = require('../../../utils/date');
const { getStatusText, getFilterStatusOptions } = require('../../../utils/status');

Page({
  data: {
    leads: [],
    loading: false,
    statusIndex: 0,
    statusOptions: getFilterStatusOptions(),
    userName: ''
  },

  onLoad() {
    this.loadLeads();
  },

  onShow() {
    // 从录入页返回时刷新列表
    this.loadLeads();
  },
  
  onRefresh() {
    this.loadLeads();
  },
  
  onPullDownRefresh() {
    this.loadLeads().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadLeads() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    try {
      const user = await login();
      if (!user) {
        wx.redirectTo({ url: '/pages/login/index' });
        return;
      }

      // 显示当前登录账号姓名
      this.setData({
        userName: user.name || ''
      });

      const res = await wx.cloud.callFunction({
        name: 'leadList',
        data: {
          status: this.data.statusOptions[this.data.statusIndex].value || undefined
        }
      });

      if (res.result.success) {
        const leads = (res.result.data.list || []).map(lead => ({
          ...lead,
          lastFollowUpAt: lead.lastFollowUpAt ? formatDateOnly(lead.lastFollowUpAt) : null,
          createdAtDate: lead.createdAt ? formatDateOnly(lead.createdAt) : '',
          lastStatusText: getStatusText(lead.lastStatus)
        }));
        this.setData({
          leads,
          loading: false
        });
        return Promise.resolve();
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
        this.setData({ loading: false });
        return Promise.reject(new Error(res.result.message || '加载失败'));
      }
    } catch (error) {
      console.error('加载线索列表失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return Promise.reject(error);
    }
  },

  onStatusChange(e) {
    this.setData({ statusIndex: e.detail.value });
    this.loadLeads();
  },

  onAddLead() {
    wx.navigateTo({ url: '/pages/anchor/lead-edit/index' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  onLeadTap(e) {
    const lead = e.currentTarget.dataset.lead;
    wx.navigateTo({
      url: `/pages/lead-detail/index?leadId=${lead._id}`
    });
  },

  onFollowUpTap(e) {
    // 阻止冒泡：点击“跟进”不进入详情
    const leadId = e.currentTarget.dataset.id;
    if (!leadId) return;
    wx.navigateTo({
      url: `/pages/followup-edit/index?leadId=${leadId}`
    });
  },

  onDeleteLead(e) {
    const lead = e.currentTarget.dataset.lead;
    const that = this;
    wx.showModal({
      title: '确认删除',
      content: '删除后将无法恢复，确定要删除这条线索吗？',
      success: async function(res) {
        if (res.confirm) {
          await that.deleteLead(lead._id);
        }
      }
    });
  },

  goUserDetail(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId) return;
    wx.navigateTo({
      url: `/pages/user-detail/index?userId=${userId}`
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
        this.loadLeads();
      } else {
        wx.showToast({ title: res.result.message || '删除失败', icon: 'none' });
      }
    } catch (error) {
      wx.hideLoading();
      console.error('删除线索失败:', error);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});
