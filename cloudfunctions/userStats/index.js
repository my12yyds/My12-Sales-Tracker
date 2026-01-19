const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: "无法获取 openid" };

  const meRes = await db.collection("users").where({ openid }).limit(1).get();
  if (!meRes.data || meRes.data.length === 0) {
    return { success: false, message: "用户不存在，请先登录" };
  }
  const me = meRes.data[0];
  const userId = me._id;

  // 管理员：返回全量的总体统计（轻量）
  if (me.role === 0) {
    const leadsCount = await db.collection("leads").count().catch(() => ({ total: 0 }));
    const followUpsCount = await db.collection("followUps").count().catch(() => ({ total: 0 }));
    return {
      success: true,
      data: {
        role: me.role,
        totalLeads: leadsCount.total || 0,
        totalFollowUps: followUpsCount.total || 0
      }
    };
  }

  // 主播：统计本组线索数、已跟进线索数
  if (me.role === 1) {
    const groupId = me.groupId;
    const totalLeadsRes = await db.collection("leads").where({ groupId }).count().catch(() => ({ total: 0 }));
    const followedLeadsRes = await db
      .collection("leads")
      .where({
        groupId,
        followUpCount: db.command.gt(0)
      })
      .count()
      .catch(() => ({ total: 0 }));

    return {
      success: true,
      data: {
        role: me.role,
        groupId,
        totalLeads: totalLeadsRes.total || 0,
        followedLeads: followedLeadsRes.total || 0
      }
    };
  }

  // 销售：统计分配给我的线索数、我写的跟进数、已跟进线索数（followUpCount>0）
  const totalLeadsRes = await db
    .collection("leads")
    .where({ assignedSalesIds: userId })
    .count()
    .catch(() => ({ total: 0 }));

  const followedLeadsRes = await db
    .collection("leads")
    .where({
      assignedSalesIds: userId,
      followUpCount: db.command.gt(0)
    })
    .count()
    .catch(() => ({ total: 0 }));

  const myFollowUpsRes = await db
    .collection("followUps")
    .where({ salesId: userId })
    .count()
    .catch(() => ({ total: 0 }));

  return {
    success: true,
    data: {
      role: me.role,
      groupId: me.groupId || 0,
      totalLeads: totalLeadsRes.total || 0,
      followedLeads: followedLeadsRes.total || 0,
      myFollowUps: myFollowUpsRes.total || 0
    }
  };
};

