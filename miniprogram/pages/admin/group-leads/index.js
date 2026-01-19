const auth = require('../../../utils/auth');
const { login } = auth;
const { formatDateOnly } = require('../../../utils/date');
const { getStatusText, getFilterStatusOptions } = require('../../../utils/status');

Page({
  data: {
    groupId: 0,
    leads: [],
    loading: false,
    statusIndex: 0,
    statusOptions: [
      { label: '全部状态', value: '' },
      { label: '未联系', value: 'NEW' },
      { label: '已联系', value: 'CONTACTED' },
      { label: '已报价', value: 'QUOTED' },
      { label: '成交', value: 'WON' },
      { label: '流失', value: 'LOST' }
    ]
  },

  onLoad(options) {
    const { groupId } = options;
    if (!groupId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ groupId: Number(groupId) });
    this.loadLeads();
  },

  onShow() {
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
      if (!user || user.role !== 0) {
        wx.showToast({ title: '无权限', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      const res = await wx.cloud.callFunction({
        name: 'leadList',
        data: {
          groupId: this.data.groupId,
          status: this.data.statusOptions[this.data.statusIndex].value || undefined
        }
      });

      if (res.result.success) {
        const leads = (res.result.data.list || []).map(lead => ({
          ...lead,
          lastFollowUpAt: lead.lastFollowUpAt ? formatDateOnly(lead.lastFollowUpAt) : null,
          createdAtDate: lead.createdAt ? formatDateOnly(lead.createdAt) : '',
          createdByName: lead.createdByName || '未知',
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

  onLeadTap(e) {
    const lead = e.currentTarget.dataset.lead;
    wx.navigateTo({
      url: `/pages/lead-detail/index?leadId=${lead._id}`
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
        this.loadLeads();
      } else {
        wx.showToast({ title: res.result.message || '删除失败', icon: 'none' });
      }
    } catch (error) {
      wx.hideLoading();
      console.error('删除线索失败:', error);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  goUserDetail(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId) return;
    wx.navigateTo({
      url: `/pages/user-detail/index?userId=${userId}`
    });
  }
});
