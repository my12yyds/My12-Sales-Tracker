const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 获取线索列表
 * - 主播：返回本组所有线索
 * - 销售：返回分配给自己（assignedSalesIds包含自己）的线索
 * - 管理员：返回所有线索
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

    // 2. 构建查询条件
    let query = {};
    
    if (role === 1) {
      // 主播：本组所有线索
      query.groupId = groupId;
    } else if (role === 2) {
      // 销售：分配给自己（assignedSalesIds包含自己）的线索
      query.assignedSalesIds = userId;
    } else if (role === 0) {
      // 管理员：所有线索（可选：按组筛选）
      if (event.groupId) {
        query.groupId = event.groupId;
      }
    } else {
      return { success: false, message: '无权限访问' };
    }

    // 3. 可选的状态筛选
    if (event.status) {
      query.lastStatus = event.status;
    }

    // 4. 分页参数
    const page = event.page || 1;
    const pageSize = event.pageSize || 20;
    const skip = (page - 1) * pageSize;

    // 5. 查询线索列表
    const leadsRes = await db.collection('leads')
      .where(query)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();

    // 6. 查询总数
    const countRes = await db.collection('leads').where(query).count();

    // 7. 查询所有相关用户（销售和主播）的姓名
    const leadIds = leadsRes.data.map(l => l._id);
    const salesIds = new Set();
    const anchorIds = new Set();
    leadsRes.data.forEach(lead => {
      if (lead.assignedSalesIds && Array.isArray(lead.assignedSalesIds)) {
        lead.assignedSalesIds.forEach(sid => salesIds.add(sid));
      }
      if (lead.createdByAnchorId) {
        anchorIds.add(lead.createdByAnchorId);
      }
    });

    let salesMap = {};
    if (salesIds.size > 0) {
      const salesRes = await db.collection('users')
        .where({
          _id: db.command.in(Array.from(salesIds))
        })
        .field({ _id: true, name: true })
        .get();
      salesRes.data.forEach(s => {
        salesMap[s._id] = s.name || '未命名';
      });
    }

    let anchorMap = {};
    if (anchorIds.size > 0) {
      const anchorRes = await db.collection('users')
        .where({
          _id: db.command.in(Array.from(anchorIds))
        })
        .field({ _id: true, name: true })
        .get();
      anchorRes.data.forEach(a => {
        anchorMap[a._id] = a.name || '未命名';
      });
    }

    // 8. 组装返回数据
    const list = leadsRes.data.map(lead => ({
      _id: lead._id,
      groupId: lead.groupId,
      phone: lead.phone,
      status: lead.status,
      lastStatus: lead.lastStatus,
      remarks: lead.remarks,
      createdAt: lead.createdAt,
      lastFollowUpAt: lead.lastFollowUpAt,
      followUpCount: lead.followUpCount || 0,
      createdByAnchorId: lead.createdByAnchorId,
      createdByName: anchorMap[lead.createdByAnchorId] || '未知',
      assignedSalesIds: lead.assignedSalesIds || [],
      assignedSalesNames: (lead.assignedSalesIds || []).map(sid => salesMap[sid] || '未知').join('、')
    }));

    return {
      success: true,
      data: {
        list,
        total: countRes.total,
        page,
        pageSize
      }
    };
  } catch (error) {
    console.error('获取线索列表失败:', error);
    return { success: false, message: '获取线索列表失败：' + error.message };
  }
};
