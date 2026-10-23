const cloud = require('wx-server-sdk');
const { buildFilters } = require('./filters');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 获取线索列表
 * - 负责人：返回本团队所有线索
 * - 成员：返回分配给自己（assignedSalesIds包含自己）的线索
 * - 管理员：返回所有线索
 */
exports.main = async (event = {}, context) => {
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

    if ((role === 1 || role === 2) && !(Number.isSafeInteger(groupId) && groupId > 0)) {
      return { success: false, message: '请先联系管理员分配团队' };
    }

    const page = event.page === undefined ? 1 : event.page;
    const pageSize = event.pageSize === undefined ? 20 : event.pageSize;
    if (!Number.isSafeInteger(page) || page < 1 ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
        !Number.isSafeInteger((page - 1) * pageSize)) {
      return { success: false, message: '分页参数无效：page 为正整数，pageSize 为 1~100 的整数' };
    }

    // 2. 构建查询条件
    let query = {};
    
    if (role === 1) {
      // 负责人：本团队所有线索
      query.groupId = groupId;
    } else if (role === 2) {
      // 成员：分配给自己（assignedSalesIds包含自己）的线索
      query.assignedSalesIds = userId;
      query.groupId = groupId;
    } else if (role === 0) {
      // 管理员：所有线索（可选：按组筛选）
      // 0/未传表示不筛选；传入时必须是正整数，避免字符串型 groupId 静默查不到数据
      if (event.groupId) {
        if (!Number.isSafeInteger(event.groupId) || event.groupId < 1) {
          return { success: false, message: '团队筛选无效：需为正整数' };
        }
        query.groupId = event.groupId;
      }
    } else {
      return { success: false, message: '无权限访问' };
    }

    // 3. 可选的状态筛选
    if (event.status) {
      if (!['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'].includes(event.status)) {
        return { success: false, message: '状态筛选无效' };
      }
      // Historic leads may have status but no lastStatus.
      query = db.command.and([query, db.command.or([
        { lastStatus: event.status },
        { lastStatus: db.command.exists(false), status: event.status }
      ])]);
    }
    let filters;
    try { filters = buildFilters(db, query, event); }
    catch (error) { return { success: false, message: error.message }; }
    query = filters.query;

    // 4. 分页参数
    const skip = (page - 1) * pageSize;

    // 5. 查询线索列表
    const leadsRes = await db.collection('leads')
      .where(query)
      .orderBy(filters.order[0], filters.order[1])
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get();

    // 6. 查询总数
    const countRes = await db.collection('leads').where(query).count();

    // 7. 查询所有相关用户（成员和负责人）的姓名
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
      customerName: lead.customerName || '',
      status: lead.status,
      lastStatus: lead.lastStatus || lead.status || 'NEW',
      remarks: lead.remarks,
      createdAt: lead.createdAt,
      lastFollowUpAt: lead.lastFollowUpAt,
      nextFollowUpAt: lead.nextFollowUpAt || null,
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
