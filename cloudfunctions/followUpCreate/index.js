const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 创建跟进记录（销售/主播）
 * 多销售协作：销售需在 assignedSalesIds 中；主播可对自己创建且同组的线索添加
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 1. 获取用户信息
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) {
      return { success: false, message: '用户不存在，请先登录' };
    }
    const user = userRes.data[0];
    const { _id: userId, role, groupId } = user;

    // 2. 权限校验：销售/主播可创建跟进
    const isSales = role === 2;
    const isAnchor = role === 1;
    if (!isSales && !isAnchor) {
      return { success: false, message: '只有销售或主播可以创建跟进记录' };
    }

    // 3. 参数校验
    const { leadId, followUpDate, status, remarks, advanceToNext } = event;
    if (!leadId) {
      return { success: false, message: '线索ID不能为空' };
    }
    if (!followUpDate) {
      return { success: false, message: '跟进日期不能为空' };
    }
    if (!status) {
      return { success: false, message: '跟进状态不能为空' };
    }

    // 4. 查询线索
    const leadRes = await db.collection('leads').doc(leadId).get();
    const lead = leadRes.data;
    if (!lead) {
      return { success: false, message: '线索不存在' };
    }

    // 5. 权限校验
    const assignedSalesIds = lead.assignedSalesIds || [];
    const isSameGroup = lead.groupId === groupId;
    const isAssignedSales = isSales && isSameGroup && assignedSalesIds.includes(userId);
    const isGroupAnchor = isAnchor && isSameGroup;

    if (!isAssignedSales && !isGroupAnchor) {
      return { success: false, message: '无权限添加该线索的跟进记录' };
    }

    // 7. 查询该线索的上一条跟进记录（用于计算间隔天数）
    const lastFollowUpRes = await db.collection('followUps')
      .where({ leadId })
      .orderBy('followUpDate', 'desc')
      .limit(1)
      .get();

    let durationFromLast = 0;
    if (lastFollowUpRes.data.length > 0) {
      const lastDate = new Date(lastFollowUpRes.data[0].followUpDate);
      const currentDate = new Date(followUpDate);
      durationFromLast = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
    }

    // 8. 如果选择推进到下一个进程，自动设置下一个状态
    let finalStatus = status;
    if (advanceToNext) {
      const currentStatus = lead.lastStatus || lead.status || 'NEW';
      const statusFlow = {
        'NEW': 'CONTACTED',
        'CONTACTED': 'QUOTED',
        'QUOTED': status // 已报价后需要手动选择成交或流失
      };
      
      // 如果当前状态在流程中，且新状态不是成交或流失，则使用流程中的下一个状态
      if (statusFlow[currentStatus] && status !== 'WON' && status !== 'LOST') {
        finalStatus = statusFlow[currentStatus];
      }
    }

    // 9. 创建跟进记录
    const now = new Date();
    const followUpData = {
      leadId,
      groupId: lead.groupId,
      salesId: userId, // 兼容旧字段，表示操作人ID
      operatorRole: role,
      followUpDate: new Date(followUpDate),
      status: finalStatus,
      remarks: remarks || '',
      durationFromLast,
      createdAt: now
    };

    const addRes = await db.collection('followUps').add({ data: followUpData });

    // 10. 更新线索的时间统计字段
    const updateData = {
      lastFollowUpAt: new Date(followUpDate),
      lastStatus: finalStatus,
      followUpCount: (lead.followUpCount || 0) + 1,
      updatedAt: now
    };

    // 如果是首次跟进
    if (!lead.firstFollowUpAt) {
      updateData.firstFollowUpAt = new Date(followUpDate);
    }

    // 如果状态是成交
    if (finalStatus === 'WON') {
      updateData.wonAt = new Date(followUpDate);
      updateData.status = 'WON';
    }

    // 如果状态是流失
    if (finalStatus === 'LOST') {
      updateData.lostAt = new Date(followUpDate);
      updateData.status = 'LOST';
    }

    await db.collection('leads').doc(leadId).update({ data: updateData });

    return {
      success: true,
      data: {
        _id: addRes._id,
        ...followUpData
      }
    };
  } catch (error) {
    console.error('创建跟进记录失败:', error);
    return { success: false, message: '创建跟进记录失败：' + error.message };
  }
};
