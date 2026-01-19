const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 创建线索（主播）
 * 支持多销售协作：可指定一个或多个销售ID
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

    // 2. 权限校验：只有主播可以创建线索
    if (role !== 1) {
      return { success: false, message: '只有主播可以创建线索' };
    }

    // 3. 参数校验
    const { phone, assignedSalesIds, remarks } = event;
    if (!phone || !phone.trim()) {
      return { success: false, message: '客户电话不能为空' };
    }

    // 4. 如果指定了销售ID，验证销售是否在本组
    let finalAssignedSalesIds = [];
    if (assignedSalesIds && Array.isArray(assignedSalesIds) && assignedSalesIds.length > 0) {
      // 查询指定的销售是否都在本组
      const salesRes = await db.collection('users')
        .where({
          _id: db.command.in(assignedSalesIds),
          role: 2,
          groupId: groupId
        })
        .get();
      
      if (salesRes.data.length !== assignedSalesIds.length) {
        return { success: false, message: '指定的销售不在本组或不存在' };
      }
      finalAssignedSalesIds = assignedSalesIds;
    } else {
      // 5. 如果没有指定销售，自动分配本组最少负载的销售
      const salesRes = await db.collection('users')
        .where({
          role: 2,
          groupId: groupId
        })
        .get();
      
      if (salesRes.data.length === 0) {
        return { success: false, message: '本组没有销售，无法分配' };
      }

      // 统计每个销售的线索数量（分配给自己或包含自己的）
      const salesIds = salesRes.data.map(s => s._id);
      const leadsRes = await db.collection('leads')
        .where({
          groupId: groupId,
          assignedSalesIds: db.command.in(salesIds)
        })
        .get();

      // 统计每个销售的线索数
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

      // 找到最少负载的销售（如果有多个，取第一个）
      const minCount = Math.min(...Object.values(salesLeadCount));
      const minSalesId = Object.keys(salesLeadCount).find(id => salesLeadCount[id] === minCount);
      finalAssignedSalesIds = [minSalesId];
    }

    // 6. 创建线索
    const now = new Date();
    const leadData = {
      groupId: groupId,
      phone: phone.trim(),
      createdByAnchorId: userId,
      assignedSalesId: finalAssignedSalesIds[0] || null, // 主负责人（向后兼容）
      assignedSalesIds: finalAssignedSalesIds, // 多销售协作数组
      status: 'NEW',
      remarks: remarks || '',
      createdAt: now,
      updatedAt: now,
      followUpCount: 0
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
