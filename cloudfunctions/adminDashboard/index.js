const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const PAGE_SIZE = 1000; // 云函数单次查询上限
const MAX_SCAN = 20000; // 单次统计的扫描上限，超出后返回 partial 标记
const TERMINAL = ['WON', 'LOST'];
const DAY_MS = 86400000;
const STATUS_KEYS = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'];

/**
 * 分页读取全部数据。
 * 单次 get() 在云函数中最多返回 1000 条，直接 get() 会让统计结果
 * 在数据量超过上限后悄悄变少，这里必须分页。
 */
async function fetchAll(collection, field, where) {
  const rows = [];
  let partial = false;
  for (let skip = 0; skip < MAX_SCAN; skip += PAGE_SIZE) {
    let query = db.collection(collection);
    if (where) query = query.where(where);
    if (field) query = query.field(field);
    const res = await query.orderBy('_id', 'asc').skip(skip).limit(PAGE_SIZE).get();
    rows.push(...res.data);
    if (res.data.length < PAGE_SIZE) return { rows, partial };
  }
  partial = true;
  return { rows, partial };
}

/** 中国日历日的零点，避免依赖服务器时区 */
function chinaStart(dayText) {
  return new Date(dayText + 'T00:00:00+08:00');
}

function chinaToday(now) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function effectiveStatus(lead) {
  return lead.lastStatus || lead.status || 'NEW';
}

/** nextFollowUpAt 存的是中国零点（UTC 前一天 16:00），直接 slice ISO 会少一天 */
function chinaDayText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function emptyStatusStats() {
  return STATUS_KEYS.reduce((acc, key) => { acc[key] = 0; return acc; }, {});
}

function rate(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
}

async function readAll(name) {
  const rows = [];
  for (let skip = 0; skip < 10000; skip += 100) {
    const page = await db.collection(name).orderBy('_id', 'asc').skip(skip).limit(100).get();
    rows.push(...page.data);
    if (page.data.length < 100) return { data: rows };
  }
  throw new Error('统计数据量过大，请改用聚合统计');
}

/**
 * 管理员数据看板统计
 * 各团队线索量、跟进率、状态分布、成交转化率、待跟进积压，以及成员业绩排行。
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const userRes = await db.collection('users').where({ openid }).limit(1).get();
    if (userRes.data.length === 0) {
      return { success: false, message: '用户不存在，请先登录' };
    }
    if (userRes.data[0].role !== 0) {
      return { success: false, message: '只有管理员可以查看数据看板' };
    }

    // 3. 查询所有用户和线索数据（分页读取，避免单次上限）
    const now = new Date();
    const todayStart = chinaStart(chinaToday(now));
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);

    const usersResult = await fetchAll('users', { _id: true, name: true, role: true, groupId: true });
    const leadsResult = await fetchAll('leads');
    // 只需要判定「是否已跟进」和归属成员，避免拉取大字段
    const followUpsResult = await fetchAll('followUps', { leadId: true, salesId: true, status: true });

    const allUsers = usersResult.rows;
    const allLeads = leadsResult.rows;
    const allFollowUps = followUpsResult.rows;
    const partial = usersResult.partial || leadsResult.partial || followUpsResult.partial;

    const userNameMap = {};
    allUsers.forEach(u => { userNameMap[u._id] = u.name || '未命名'; });

    const followedLeadIds = new Set(allFollowUps.map(f => f.leadId));
    const followUpCountByLead = {};
    const followUpCountBySales = {};
    allFollowUps.forEach(f => {
      if (f.leadId) followUpCountByLead[f.leadId] = (followUpCountByLead[f.leadId] || 0) + 1;
      if (f.salesId) followUpCountBySales[f.salesId] = (followUpCountBySales[f.salesId] || 0) + 1;
    });

    // 4. 按团队统计
    const isFollowed = lead => (lead.followUpCount || 0) > 0 || followedLeadIds.has(lead._id) ||
      (followUpCountByLead[lead._id] || 0) > 0;

    const isDueToday = lead => !!lead.nextFollowUpAt &&
      new Date(lead.nextFollowUpAt) >= todayStart && new Date(lead.nextFollowUpAt) < tomorrowStart &&
      !TERMINAL.includes(effectiveStatus(lead));

    const isOverdue = lead => !!lead.nextFollowUpAt &&
      new Date(lead.nextFollowUpAt) < todayStart &&
      !TERMINAL.includes(effectiveStatus(lead));

    const buildStats = (leads) => {
      const statusStats = emptyStatusStats();
      let followed = 0, dueToday = 0, overdue = 0, followUpSum = 0;
      leads.forEach(lead => {
        const status = effectiveStatus(lead);
        if (statusStats[status] !== undefined) statusStats[status]++;
        if (isFollowed(lead)) followed++;
        if (isDueToday(lead)) dueToday++;
        if (isOverdue(lead)) overdue++;
        followUpSum += lead.followUpCount || 0;
      });
      const total = leads.length;
      return {
        totalLeads: total,
        followedLeads: followed,
        followUpRate: rate(followed, total),
        statusStats,
        wonCount: statusStats.WON,
        lostCount: statusStats.LOST,
        conversionRate: rate(statusStats.WON, total),
        dueToday,
        overdue,
        avgFollowUpCount: total > 0 ? Math.round((followUpSum / total) * 100) / 100 : 0
      };
    };

    // 动态获取所有团队ID（从用户和线索中收集）
    const teamIds = [...new Set([...allUsers, ...allLeads].map(row => row.groupId))]
      .filter(id => Number.isSafeInteger(id) && id > 0).sort((a, b) => a - b);

    const groupStats = [];
    for (const groupId of teamIds) {
      const groupLeads = allLeads.filter(l => l.groupId === groupId);
      const stats = buildStats(groupLeads);
      const anchors = allUsers.filter(u => u.groupId === groupId && u.role === 1);
      const sales = allUsers.filter(u => u.groupId === groupId && u.role === 2);
      groupStats.push({
        groupId,
        ...stats,
        anchors: anchors.length,
        sales: sales.length,
        anchorNames: anchors.map(a => a.name || '未命名'),
        salesNames: sales.map(s => s.name || '未命名'),
        leads: groupLeads
          .slice()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 3)
          .map(lead => ({
            _id: lead._id,
            phone: lead.phone,
            customerName: lead.customerName || '',
            lastStatus: effectiveStatus(lead),
            followUpCount: lead.followUpCount || 0,
            lastFollowUpDate: lead.lastFollowUpAt ? new Date(lead.lastFollowUpAt).toISOString().slice(0, 10) : '',
            nextFollowUpDate: chinaDayText(lead.nextFollowUpAt),
            createdAt: lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
            createdBy: userNameMap[lead.createdByAnchorId] || '未命名',
            createdById: lead.createdByAnchorId,
            assignedSalesNames: (lead.assignedSalesIds || []).map(id => userNameMap[id] || '未知').join('、') || '未分配',
            assignedSalesIds: lead.assignedSalesIds || []
          }))
      });
    }

    // 销售业绩排行：分配量、跟进量、成交、转化率
    // 团队编号为正整数，不限定为 1~4，避免团队 5 以上的成员被漏统计
    const salesRanking = allUsers
      .filter(u => u.role === 2 && Number.isSafeInteger(u.groupId) && u.groupId >= 1)
      .map(user => {
        const assigned = allLeads.filter(lead =>
          Array.isArray(lead.assignedSalesIds) && lead.assignedSalesIds.includes(user._id));
        const won = assigned.filter(lead => effectiveStatus(lead) === 'WON').length;
        const overdue = assigned.filter(isOverdue).length;
        return {
          _id: user._id,
          name: user.name || '未命名',
          groupId: user.groupId,
          assignedCount: assigned.length,
          followedCount: assigned.filter(isFollowed).length,
          followUpCount: followUpCountBySales[user._id] || 0,
          wonCount: won,
          overdueCount: overdue,
          conversionRate: rate(won, assigned.length)
        };
      })
      .sort((a, b) => b.wonCount - a.wonCount || b.followUpCount - a.followUpCount ||
        b.assignedCount - a.assignedCount)
      .slice(0, 50);

    const summary = buildStats(allLeads);

    return {
      success: true,
      data: {
        generatedAt: now.toISOString(),
        partial, // true 表示数据量超过单次统计上限，指标为近似值
        summary: {
          ...summary,
          totalFollowUps: allFollowUps.length,
          totalStatusStats: summary.statusStats
        },
        groupStats,
        salesRanking
      }
    };
  } catch (error) {
    console.error('获取数据看板失败:', error);
    return { success: false, message: '获取数据看板失败：' + error.message };
  }
};
