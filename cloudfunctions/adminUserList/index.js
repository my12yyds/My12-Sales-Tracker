const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: "无法获取 openid" };

  // 校验管理员
  const meRes = await db.collection("users").where({ openid }).limit(1).get();
  if (!meRes.data || meRes.data.length === 0) {
    return { success: false, message: "用户不存在，请先登录" };
  }
  const me = meRes.data[0];
  if (me.role !== 0) return { success: false, message: "仅管理员可操作" };

  // 可选筛选：role/groupId
  const role = typeof event?.role === "number" ? event.role : undefined;
  const groupId = typeof event?.groupId === "number" ? event.groupId : undefined;

  let query = db.collection("users");
  if (role !== undefined) query = query.where({ role });
  if (groupId !== undefined) query = (role !== undefined ? query : query.where({})).where({ groupId });

  // 简化：最多返回 200 条（够初始化用）
  // 管理员可以看到所有字段，包括手机号和微信号
  const res = await query
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const list = (res.data || []).map((u) => ({
    _id: u._id,
    openid: u.openid,
    role: u.role,
    groupId: u.groupId || 0,
    name: u.name || "",
    phone: u.phone || "",
    wechat: u.wechat || "",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  }));

  return { success: true, data: { list, total: list.length } };
};

