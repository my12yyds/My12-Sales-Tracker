const cloud = require('wx-server-sdk');
const { parsePhones, MAX_BATCH } = require('./phones');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const PAGE_SIZE = 1000; // 云函数单次查询上限
const MAX_SCAN = 20000; // 负载统计与查重的扫描上限，超出时提示改用单条录入

/**
 * 批量查询，避免单次 get() 被云函数条数上限截断。
 */
async function fetchAll(collection, where, field) {
  const rows = [];
  for (let skip = 0; skip < MAX_SCAN; skip += PAGE_SIZE) {
    let query = db.collection(collection).where(where);
    if (field) query = query.field(field);
    const res = await query.orderBy('_id', 'asc').skip(skip).limit(PAGE_SIZE).get();
    rows.push(...res.data);
    if (res.data.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * 批量创建线索（主播）
 * 输入：{ phones: string[] | string, remarks, assignedSalesIds }
 * 组内已存在的号码会被跳过，返回明细便于前端提示。
 */
exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) {
      return { success: false, message: '用户不存在，请先登录' };
    }
    const user = userRes.data[0];
    const { _id: userId, role, groupId } = user;

    if (role !== 1) {
      return { success: false, message: '只有主播可以批量录入线索' };
    }
    if (!Number.isSafeInteger(groupId) || groupId < 1) {
      return { success: false, message: '请先联系管理员分配小组' };
    }

    const { remarks, assignedSalesIds } = event;
    if (remarks !== undefined && typeof remarks !== 'string') {
      return { success: false, message: '备注须为文本' };
    }
    if (remarks && remarks.length > 500) {
      return { success: false, message: '备注最多500个字符' };
    }

    const parsed = parsePhones(event.phones);
    if (parsed.valid.length === 0) {
      return {
        success: false,
        message: '没有可用的电话号码',
        data: { invalid: parsed.invalid, repeated: parsed.repeated }
      };
    }
    if (parsed.valid.length > MAX_BATCH) {
      return { success: false, message: `单次最多录入 ${MAX_BATCH} 条线索，请分批提交` };
    }

    // 校验销售归属
    let finalAssignedSalesIds = [];
    if (assignedSalesIds !== undefined && !Array.isArray(assignedSalesIds)) {
      return { success: false, message: '销售列表格式错误' };
    }
    if (Array.isArray(assignedSalesIds) && assignedSalesIds.length > 0) {
      const salesRes = await db.collection('users')
        .where({ _id: _.in(assignedSalesIds), role: 2, groupId })
        .get();
      if (salesRes.data.length !== assignedSalesIds.length) {
        return { success: false, message: '指定的销售不在本组或不存在' };
      }
      finalAssignedSalesIds = assignedSalesIds;
    } else {
      const salesRes = await db.collection('users').where({ role: 2, groupId }).get();
      if (salesRes.data.length === 0) {
        return { success: false, message: '本组没有销售，无法分配' };
      }
      const salesIds = salesRes.data.map(s => s._id);

      // 当前负载：每条线索的 assignedSalesIds 计入各销售
      const existingLeads = await fetchAll('leads',
        { groupId, assignedSalesIds: _.in(salesIds) }, { assignedSalesIds: true });
      const load = {};
      salesIds.forEach(id => { load[id] = 0; });
      existingLeads.forEach(lead => {
        (lead.assignedSalesIds || []).forEach(sid => {
          if (load[sid] !== undefined) load[sid]++;
        });
      });

      // 批量内部按「当前最轻负载」逐个分配，使新增线索均匀落地
      finalAssignedSalesIds = { type: 'balanced', salesIds, load };
    }

    // 组内已存在的号码先查出来，一次写入，避免逐条查询
    const existing = await fetchAll('leads', { groupId, phone: _.in(parsed.valid) }, { phone: true });
    const existingPhones = new Set(existing.map(lead => lead.phone));
    const duplicates = parsed.valid.filter(phone => existingPhones.has(phone));
    const toCreate = parsed.valid.filter(phone => !existingPhones.has(phone));

    const now = new Date();
    const created = [];
    const failed = [];

    for (const phone of toCreate) {
      let salesIdsForLead;
      if (Array.isArray(finalAssignedSalesIds)) {
        salesIdsForLead = finalAssignedSalesIds;
      } else {
        const { salesIds, load } = finalAssignedSalesIds;
        const minCount = Math.min(...salesIds.map(id => load[id]));
        const chosen = salesIds.find(id => load[id] === minCount);
        load[chosen]++;
        salesIdsForLead = [chosen];
      }

      const leadData = {
        groupId,
        phone,
        createdByAnchorId: userId,
        assignedSalesId: salesIdsForLead[0] || null,
        assignedSalesIds: salesIdsForLead,
        status: 'NEW',
        lastStatus: 'NEW',
        remarks: remarks || '',
        createdAt: now,
        updatedAt: now,
        followUpCount: 0,
        batchId: `batch-${now.getTime()}-${String(userId).slice(-6)}`
      };

      try {
        const addRes = await db.collection('leads').add({ data: leadData });
        created.push({ _id: addRes._id, phone });
      } catch (error) {
        console.error('批量录入单条失败:', phone, error);
        failed.push({ phone, message: error.message || '写入失败' });
      }
    }

    return {
      success: true,
      data: {
        createdCount: created.length,
        duplicateCount: duplicates.length,
        invalidCount: parsed.invalid.length,
        failedCount: failed.length,
        created,
        duplicates,
        invalid: parsed.invalid,
        repeatedInInput: parsed.repeated,
        failed
      }
    };
  } catch (error) {
    console.error('批量录入线索失败:', error);
    return { success: false, message: '批量录入失败：' + error.message };
  }
};
