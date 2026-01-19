const { login } = require('../../utils/auth');
const { getStatusOptions, getStatusText } = require('../../utils/status');

Page({
  data: {
    leadId: '',
    lead: null,
    followUpDate: '',
    statusIndex: 0,
    statusOptions: getStatusOptions(),
    remarks: '',
    submitting: false,
    advanceToNext: false // 是否推进到下一个进程
  },

  async onLoad(options) {
    const { leadId } = options;
    if (!leadId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    
    // 默认今天
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    this.setData({ 
      leadId,
      followUpDate: dateStr
    });

    // 加载线索信息，用于推进到下一个进程
    await this.loadLead();
  },

  async loadLead() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'leadList',
        data: {}
      });

      if (res.result.success) {
        const lead = res.result.data.list.find(l => l._id === this.data.leadId);
        if (lead) {
          this.setData({ 
            lead: {
              ...lead,
              lastStatusText: getStatusText(lead.lastStatus)
            }
          });
        }
      }
    } catch (error) {
      console.error('加载线索失败:', error);
    }
  },

  onDateChange(e) {
    this.setData({ followUpDate: e.detail.value });
  },

  onStatusChange(e) {
    this.setData({ statusIndex: e.detail.value });
  },

  onRemarksInput(e) {
    this.setData({ remarks: e.detail.value });
  },

  onAdvanceChange(e) {
    this.setData({ advanceToNext: e.detail.value });
    
    // 如果选择推进到下一个进程，自动设置下一个状态
    if (e.detail.value && this.data.lead) {
      const currentStatus = this.data.lead.lastStatus || 'NEW';
      const statusMap = {
        'NEW': 'CONTACTED',
        'CONTACTED': 'QUOTED',
        'QUOTED': 'QUOTED' // 已报价后需要手动选择成交或流失
      };
      
      const nextStatus = statusMap[currentStatus];
      if (nextStatus) {
        const nextIndex = this.data.statusOptions.findIndex(opt => opt.value === nextStatus);
        if (nextIndex >= 0) {
          this.setData({ statusIndex: nextIndex });
        }
      }
    }
  },

  async onSubmit() {
    const { leadId, followUpDate, statusOptions, statusIndex, remarks, submitting, advanceToNext } = this.data;
    
    if (!followUpDate) {
      wx.showToast({ title: '请选择跟进日期', icon: 'none' });
      return;
    }

    if (submitting) return;
    this.setData({ submitting: true });

    try {
      const user = await login();
      const role = user?.role;
      const allowed = role === 1 || role === 2;
      if (!user || !allowed) {
        wx.showToast({ title: '无权限提交', icon: 'none' });
        this.setData({ submitting: false });
        return;
      }

      const res = await wx.cloud.callFunction({
        name: 'followUpCreate',
        data: {
          leadId,
          followUpDate,
          status: statusOptions[statusIndex].value,
          remarks: remarks.trim(),
          advanceToNext: advanceToNext || false
        }
      });

      if (res.result.success) {
        wx.showToast({ title: '添加成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        wx.showToast({ title: res.result.message || '添加失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    } catch (error) {
      console.error('添加跟进失败:', error);
      wx.showToast({ title: '添加失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  }
});
