const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 创建线索（负责人）
 * 支持多成员协作：可指定一个或多个成员ID
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

    // 2. 权限校验：只有负责人可以创建线索
    if (role !== 1) {
      return { success: false, message: '只有负责人可以创建线索' };
    }
    if (!(Number.isSafeInteger(groupId) && groupId > 0)) {
      return { success: false, message: '请先联系管理员分配团队' };
    }

    // 3. 参数校验
    const { phone = '', customerName = '', assignedSalesIds, remarks } = event;
    if (typeof phone !== 'string' || typeof customerName !== 'string' || (!phone.trim() && !customerName.trim())) {
      return { success: false, message: '请填写客户/事项名称或联系电话' };
    }
    if (customerName.trim().length > 100 || phone.length > 50 || (remarks !== undefined && typeof remarks !== 'string')) {
      return { success: false, message: '名称最多100字符，电话最多50字符，备注须为文本' };
    }
    if (event.force !== undefined && typeof event.force !== 'boolean') {
      return { success: false, message: '重复录入选项须为布尔值' };
    }
    const normalizedPhone = phone.trim();

    // 4. 同组重复电话检测：同一条客户电话在同一小组只保留一条
    // 仅名称、无电话的线索不参与查重，否则第二条起会被误判为重复
    if (event.force !== true && normalizedPhone) {
      const duplicateRes = await db.collection('leads')
        .where({ groupId, phone: normalizedPhone })
        .limit(1)
        .get();
      if (duplicateRes.data.length > 0) {
        return {
          success: false,
          duplicate: true,
          message: '本组已存在相同客户电话',
          data: { leadId: duplicateRes.data[0]._id }
        };
      }
    }

    // 5. 如果指定了成员ID，验证成员是否在本团队
    let finalAssignedSalesIds = [];
    if (assignedSalesIds && Array.isArray(assignedSalesIds) && assignedSalesIds.length > 0) {
      // 查询指定的成员是否都在本团队
      const salesRes = await db.collection('users')
        .where({
          _id: db.command.in(assignedSalesIds),
          role: 2,
          groupId: groupId
        })
        .get();
      
      if (salesRes.data.length !== assignedSalesIds.length) {
        return { success: false, message: '指定的成员不在本团队或不存在' };
      }
      finalAssignedSalesIds = assignedSalesIds;
    } else {
      // 5. 如果没有指定成员，自动分配本团队最少负载的成员
      const salesRes = await db.collection('users')
        .where({
          role: 2,
          groupId: groupId
        })
        .get();
      
      if (salesRes.data.length === 0) {
        // A single-person team can start immediately; managers already have team access.
        finalAssignedSalesIds = [userId];
      } else {

      // 统计每个成员的线索数量（分配给自己或包含自己的）
      const salesIds = salesRes.data.map(s => s._id);
      const leadsRes = await db.collection('leads')
        .where({
          groupId: groupId,
          assignedSalesIds: db.command.in(salesIds)
        })
        .get();

      // 统计每个成员的线索数
      const salesLeadCount = {};
      salesIds.forEach(id => salesLeadCount[id] = 0);
      leadsRes.data.forEach(lead => {
        if (lead.assignedSalesIds && Array.isArray(lead.assignedSalesIds)) {
          lead.assignedSalesIds.forEach(sid => {
            if (salesLeadCount[sid] !== undefined) {
              salesLeadCount[sid]++;
            }
          });
        }
      });

      // 找到最少负载的成员（如果有多个，取第一个）
      const minCount = Math.min(...Object.values(salesLeadCount));
      const minSalesId = Object.keys(salesLeadCount).find(id => salesLeadCount[id] === minCount);
      finalAssignedSalesIds = [minSalesId];
      }
    }

    // 6. 创建线索
    const now = new Date();
    const leadData = {
      groupId: groupId,
      phone: normalizedPhone,
      customerName: customerName.trim(),
      createdByAnchorId: userId,
      assignedSalesId: finalAssignedSalesIds[0] || null, // 主负责人（向后兼容）
      assignedSalesIds: finalAssignedSalesIds, // 多成员协作数组
      status: 'NEW',
      lastStatus: 'NEW',
      remarks: remarks || '',
      createdAt: now,
      updatedAt: now,
      followUpCount: 0
      // 不写入 nextFollowUpAt：字段缺失不会被「待跟进」范围查询命中，
      // 而显式 null 在数据库比较中会被当作最小值，导致新线索误判为逾期。
    };

    const addRes = await db.collection('leads').add({ data: leadData });

    return {
      success: true,
      data: {
        _id: addRes._id,
        ...leadData
      }
    };
  } catch (error) {
    console.error('创建线索失败:', error);
    return { success: false, message: '创建线索失败：' + error.message };
  }
};
