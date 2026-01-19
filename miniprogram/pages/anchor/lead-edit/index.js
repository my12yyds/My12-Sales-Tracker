const { login } = require('../../../utils/auth');

Page({
  data: {
    phone: '',
    remarks: '',
    groupSales: [],
    submitting: false
  },

  onLoad() {
    this.loadGroupSales();
  },

  async loadGroupSales() {
    try {
      const user = await login();
      if (!user || user.role !== 1) {
        wx.showToast({ title: '无权限', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      // 查询本组销售
      const db = wx.cloud.database();
      const res = await db.collection('users')
        .where({
          role: 2,
          groupId: user.groupId
        })
        .get();

      this.setData({
        groupSales: (res.data || []).map(s => ({ ...s, checked: false }))
      });
    } catch (error) {
      console.error('加载销售列表失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onRemarksInput(e) {
    this.setData({ remarks: e.detail.value });
  },

  onSalesToggle(e) {
    const sales = e.currentTarget.dataset.sales;
    const groupSales = this.data.groupSales.map(s => {
      if (s._id === sales._id) {
        return { ...s, checked: !s.checked };
      }
      return s;
    });
    this.setData({ groupSales });
  },

  async onSubmit() {
    const { phone, remarks, groupSales, submitting } = this.data;
    
    if (!phone || !phone.trim()) {
      wx.showToast({ title: '请输入客户电话', icon: 'none' });
      return;
    }

    if (submitting) return;
    this.setData({ submitting: true });

    try {
      const selectedSalesIds = groupSales.filter(s => s.checked).map(s => s._id);
      
      const res = await wx.cloud.callFunction({
        name: 'leadCreate',
        data: {
          phone: phone.trim(),
          remarks: remarks.trim(),
          assignedSalesIds: selectedSalesIds.length > 0 ? selectedSalesIds : undefined
        }
      });

      if (res.result.success) {
        wx.showToast({ title: '录入成功', icon: 'success' });
        // 延迟返回，确保提示显示
        setTimeout(() => {
          wx.navigateBack();
          // 通知上一页刷新（通过事件或页面栈）
          const pages = getCurrentPages();
          if (pages.length > 1) {
            const prevPage = pages[pages.length - 2];
            if (prevPage && typeof prevPage.loadLeads === 'function') {
              // 延迟执行，确保页面已显示
              setTimeout(() => {
                prevPage.loadLeads();
              }, 300);
            }
          }
        }, 1500);
      } else {
        wx.showToast({ title: res.result.message || '录入失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    } catch (error) {
      console.error('录入线索失败:', error);
      wx.showToast({ title: '录入失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  }
});
