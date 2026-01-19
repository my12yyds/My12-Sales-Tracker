const { login } = require('../../utils/auth');
const { formatDateOnly } = require('../../utils/date');
const { getStatusText } = require('../../utils/status');

Page({
  data: {
    leadId: '',
    lead: null,
    followUps: [],
    loading: false,
    canAddFollowUp: false,
    canDelete: false, // 是否可以删除（主播或管理员）
    user: null
  },

  onLoad(options) {
    const { leadId } = options;
    if (!leadId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ leadId });
    this.loadData();
  },

  onShow() {
    // 从添加跟进页返回时刷新
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const user = await login();
      if (!user) {
        wx.redirectTo({ url: '/pages/login/index' });
        return;
      }

      // 加载线索详情（通过leadList获取）
      const leadRes = await wx.cloud.callFunction({
        name: 'leadList',
        data: {}
      });

      if (leadRes.result.success) {
        const lead = leadRes.result.data.list.find(l => l._id === this.data.leadId);
        if (!lead) {
          wx.showToast({ title: '线索不存在', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 1500);
          return;
        }

        // 判断是否可以添加跟进：销售（已分配且同组）、主播（同组即可）
        // 注意：authLogin 返回的用户ID字段是 userId，不是 _id
        const assignedSalesIds = lead.assignedSalesIds || [];
        const leadGroupId = lead.groupId;
        const userGroupId = user.groupId;
        const isSameGroup = leadGroupId == userGroupId; // 使用 == 处理类型差异
        
        // 销售：验证 assignedSalesIds 是否包含自己（使用 userId 字段）
        const userId = user.userId || user._id; // 兼容两种字段名
        const isSalesAssigned = userId && Array.isArray(assignedSalesIds) && assignedSalesIds.length > 0 &&
          assignedSalesIds.some(id => String(id) === String(userId));
        const isSales = user.role === 2 && isSameGroup && isSalesAssigned;
        
        // 主播：同组即可
        const isAnchor = user.role === 1 && isSameGroup;
        
        const canAddFollowUp = isSales || isAnchor;

        // 判断是否可以删除（主播或管理员）
        const canDelete = (user.role === 1 && lead.groupId === user.groupId) || user.role === 0;

        // 添加创建时间和创建者信息，状态转换为中文
        const leadWithTime = {
          ...lead,
          createdAtDate: lead.createdAt ? formatDateOnly(lead.createdAt) : '',
          createdByName: lead.createdByName || '未知',
          lastStatusText: getStatusText(lead.lastStatus)
        };

        this.setData({ lead: leadWithTime, canAddFollowUp, canDelete, user });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: leadRes.result.message || '加载失败', icon: 'none' });
        return;
      }

      // 加载跟进记录
      const followUpRes = await wx.cloud.callFunction({
        name: 'followUpList',
        data: { leadId: this.data.leadId }
      });

      if (followUpRes.result.success) {
        const followUps = (followUpRes.result.data.list || []).map(f => ({
          ...f,
          followUpDate: f.followUpDate ? formatDateOnly(f.followUpDate) : '',
          salesId: f.salesId, // 保存销售ID用于跳转
          statusText: getStatusText(f.status) // 状态转换为中文
        }));
        this.setData({
          followUps,
          loading: false
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (error) {
      console.error('加载数据失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onAddFollowUp() {
    wx.navigateTo({
      url: `/pages/followup-edit/index?leadId=${this.data.leadId}`
    });
  },

  onDeleteLead() {
    const that = this;
    wx.showModal({
      title: '确认删除',
      content: '删除后将无法恢复，确定要删除这条线索吗？',
      success: async function(res) {
        if (res.confirm) {
          await that.deleteLead();
        }
      }
    });
  },

  async deleteLead() {
    wx.showLoading({ title: '删除中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'leadDelete',
        data: {
          leadId: this.data.leadId
        }
      });

      wx.hideLoading();

      if (res.result.success) {
        wx.showToast({ title: '删除成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
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
