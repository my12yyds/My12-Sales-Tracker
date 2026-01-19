const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 获取线索的跟进记录列表
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

    // 2. 参数校验
    const { leadId } = event;
    if (!leadId) {
      return { success: false, message: '线索ID不能为空' };
    }

    // 3. 查询线索
    const leadRes = await db.collection('leads').doc(leadId).get();
    const lead = leadRes.data;
    if (!lead) {
      return { success: false, message: '线索不存在' };
    }

    // 4. 权限校验
    if (role === 1) {
      // 主播：只能查看本组线索
      if (lead.groupId !== groupId) {
        return { success: false, message: '无权限查看该线索' };
      }
    } else if (role === 2) {
      // 销售：只能查看分配给自己（assignedSalesIds包含自己）的线索
      const assignedSalesIds = lead.assignedSalesIds || [];
      if (!assignedSalesIds.includes(userId)) {
        return { success: false, message: '无权限查看该线索' };
      }
    } else if (role === 0) {
      // 管理员：可查看所有线索，无额外限制
    } else {
      return { success: false, message: '无权限访问' };
    }

    // 5. 查询跟进记录列表
    const followUpsRes = await db.collection('followUps')
      .where({ leadId })
      .orderBy('followUpDate', 'desc')
      .get();

    // 6. 查询销售姓名（用于显示）
    const salesIds = [...new Set(followUpsRes.data.map(f => f.salesId))];
    let salesMap = {};
    if (salesIds.length > 0) {
      const salesRes = await db.collection('users')
        .where({
          _id: db.command.in(salesIds)
        })
        .field({ _id: true, name: true })
        .get();
      salesRes.data.forEach(s => {
        salesMap[s._id] = s.name || '未命名';
      });
    }

    // 7. 组装返回数据
    const list = followUpsRes.data.map(f => ({
      _id: f._id,
      leadId: f.leadId,
      salesId: f.salesId,
      salesName: salesMap[f.salesId] || '未知',
      followUpDate: f.followUpDate,
      status: f.status,
      remarks: f.remarks,
      durationFromLast: f.durationFromLast || 0,
      createdAt: f.createdAt
    }));

    return {
      success: true,
      data: {
        list,
        total: list.length
      }
    };
  } catch (error) {
    console.error('获取跟进记录列表失败:', error);
    return { success: false, message: '获取跟进记录列表失败：' + error.message };
  }
};
