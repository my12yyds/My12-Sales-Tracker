const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function sanitizeName(name) {
  if (name === undefined) return undefined;
  if (typeof name !== "string") return undefined;
  const v = name.trim().slice(0, 30);
  return v;
}

function sanitizeRole(role) {
  if (role === undefined) return undefined;
  if (typeof role !== "number") return undefined;
  if (![0, 1, 2].includes(role)) return undefined;
  return role;
}

function sanitizeGroupId(groupId) {
  if (groupId === undefined) return undefined;
  if (typeof groupId !== "number") return undefined;
  // 管理员 groupId 允许 0；主播/销售 允许 1~4
  if (![0, 1, 2, 3, 4].includes(groupId)) return undefined;
  return groupId;
}

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

  const targetUserId = event?.userId;
  if (!targetUserId) return { success: false, message: "userId 不能为空" };

  const name = sanitizeName(event?.name);
  const role = sanitizeRole(event?.role);
  const groupId = sanitizeGroupId(event?.groupId);

  if (name === undefined && role === undefined && groupId === undefined) {
    return { success: false, message: "没有可更新字段" };
  }

  // 读取目标用户
  const userDoc = await db.collection("users").doc(targetUserId).get();
  if (!userDoc.data) return { success: false, message: "目标用户不存在" };

  // 规则校验
  const newRole = role !== undefined ? role : userDoc.data.role;
  const newGroupId = groupId !== undefined ? groupId : userDoc.data.groupId || 0;

  if (newRole === 0) {
    // 管理员 groupId 归 0
    if (groupId !== undefined && newGroupId !== 0) {
      return { success: false, message: "管理员 groupId 必须为 0" };
    }
  } else {
    // 主播/销售 groupId 必须 1~4
    if (![1, 2, 3, 4].includes(newGroupId)) {
      return { success: false, message: "主播/销售 groupId 必须为 1~4" };
    }
  }

  const update = { updatedAt: new Date() };
  if (name !== undefined) update.name = name;
  if (role !== undefined) update.role = role;
  if (groupId !== undefined) update.groupId = groupId;

  await db.collection("users").doc(targetUserId).update({ data: update });

  const updated = await db.collection("users").doc(targetUserId).get();
  const u = updated.data;
  return {
    success: true,
    data: {
      _id: u._id,
      openid: u.openid,
      role: u.role,
      groupId: u.groupId || 0,
      name: u.name || "",
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }
  };
};

