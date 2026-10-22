const { login } = require('../../utils/auth');
const { formatDateOnly } = require('../../utils/date');
const { getStatusText } = require('../../utils/status');
const { chinaDay, dueMeta } = require('../../utils/due');

Page({
  data: {
    leadId: '',
    lead: null,
    followUps: [],
    loading: false,
    canAddFollowUp: false,
    canDelete: false, // 是否可以删除（负责人或管理员）
    canManageAssignment: false, // 负责人：可增减本组协作成员
    groupSales: [], // 本组成员，用于分配
    assignedSales: [], // 当前协作成员 [{_id, name}]
    assigning: false,
    dueText: '',
    dueLevel: 'none',
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
    if (this.data.leadId) this.loadData();
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
        data: { leadId: this.data.leadId, pageSize: 1 }
      });

      if (leadRes.result.success) {
        const lead = leadRes.result.data.list.find(l => l._id === this.data.leadId);
        if (!lead) {
          wx.showToast({ title: '线索不存在', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 1500);
          return;
        }

        // 判断是否可以添加跟进：成员（已分配且同组）、负责人（同组即可）
        // 注意：authLogin 返回的用户ID字段是 userId，不是 _id
        const assignedSalesIds = lead.assignedSalesIds || [];
        const leadGroupId = lead.groupId;
        const userGroupId = user.groupId;
        const isSameGroup = leadGroupId == userGroupId; // 使用 == 处理类型差异

        // 成员：验证 assignedSalesIds 是否包含自己（使用 userId 字段）
        const userId = user.userId || user._id; // 兼容两种字段名
        const isSalesAssigned = userId && Array.isArray(assignedSalesIds) && assignedSalesIds.length > 0 &&
          assignedSalesIds.some(id => String(id) === String(userId));
        const isSales = user.role === 2 && isSameGroup && isSalesAssigned;

        // 负责人：同组即可
        const isAnchor = user.role === 1 && isSameGroup;

        const canAddFollowUp = isSales || isAnchor;

        // 判断是否可以删除（负责人或管理员）
        const canDelete = (user.role === 1 && lead.groupId === user.groupId) || user.role === 0;

        const due = dueMeta(lead.nextFollowUpAt);

        // 添加创建时间和创建者信息，状态转换为中文
        const leadWithTime = {
          ...lead,
          createdAtDate: lead.createdAt ? formatDateOnly(lead.createdAt) : '',
          createdByName: lead.createdByName || '未知',
          nextFollowUpDate: chinaDay(lead.nextFollowUpAt),
          lastStatusText: getStatusText(lead.lastStatus)
        };

        this.setData({
          lead: leadWithTime,
          canAddFollowUp,
          canDelete,
          canManageAssignment: isAnchor && lead.groupId >= 1,
          dueText: due.text,
          dueLevel: due.level,
          user
        });

        if (isAnchor) await this.loadGroupSales();
        this.refreshAssignedSales();
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
          salesId: f.salesId, // 保存成员ID用于跳转
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
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 把销售 ID 与姓名配对，便于按条移除 */
  refreshAssignedSales() {
    const lead = this.data.lead;
    if (!lead) return;
    const nameById = {};
    (this.data.groupSales || []).forEach(s => { nameById[s._id] = s.name; });
    const nameList = (lead.assignedSalesNames || '').split('、').filter(Boolean);
    const list = (lead.assignedSalesIds || []).map((id, index) => ({
      _id: id,
      name: nameById[id] || nameList[index] || '销售'
    }));
    this.setData({ assignedSales: list });
  },

  /** 本组销售列表，用于协作销售分配 */
  async loadGroupSales() {
    try {
      const res = await wx.cloud.callFunction({ name: 'groupMembers', data: {} });
      if (res.result && res.result.success) {
        this.setData({ groupSales: res.result.data.list || [] });
      }
    } catch (error) {
      console.error('加载本组销售失败:', error);
    }
  },

  /** 可分配的候选销售（本组内尚未分配的） */
  candidates() {
    const assigned = (this.data.lead && this.data.lead.assignedSalesIds) || [];
    return this.data.groupSales.filter(s => !assigned.some(id => String(id) === String(s._id)));
  },

  onAddAssign() {
    if (this.data.assigning) return;
    const candidates = this.candidates();
    if (candidates.length === 0) {
      wx.showToast({ title: '本组销售已全部分配', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: candidates.slice(0, 6).map(s => s.name),
      success: res => {
        const target = candidates[res.tapIndex];
        if (target) this.assignSales([target._id], 'add');
      },
      fail: () => {}
    });
  },

  onRemoveAssign(e) {
    if (this.data.assigning) return;
    const { id, name } = e.currentTarget.dataset;
    const assigned = (this.data.lead && this.data.lead.assignedSalesIds) || [];
    if (assigned.length <= 1) {
      wx.showToast({ title: '至少保留一个协作销售', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '移除协作销售',
      content: '确定将「' + (name || '该销售') + '」从这条线索移除吗？历史跟进记录会保留。',
      success: res => {
        if (res.confirm) this.assignSales([id], 'remove');
      }
    });
  },

  async assignSales(salesIds, action) {
    this.setData({ assigning: true });
    wx.showLoading({ title: '处理中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'leadAssignSales',
        data: { leadId: this.data.leadId, salesIds, action }
      });
      wx.hideLoading();
      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.message) || '操作失败');
      }
      wx.showToast({ title: action === 'add' ? '已添加' : '已移除', icon: 'success' });
      await this.loadData();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ assigning: false });
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
  },

  onCall() {
    if (!this.data.lead || !this.data.lead.phone) return;
    wx.makePhoneCall({ phoneNumber: String(this.data.lead.phone), fail() {} });
  }
});
