const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function sanitizeName(name) {
  if (name === undefined) return undefined;
  if (typeof name !== "string") return undefined;
  const v = name.trim().slice(0, 30);
  return v || "";
}

function sanitizeText(text, max = 32) {
  if (text === undefined) return undefined;
  if (typeof text !== "string") return undefined;
  const v = text.trim().slice(0, max);
  return v || "";
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: "无法获取 openid" };

  const name = sanitizeName(event?.name);
  const phone = sanitizeText(event?.phone, 20);
  const wechat = sanitizeText(event?.wechat, 32);
  if (name === undefined && phone === undefined && wechat === undefined) {
    return { success: false, message: "没有可更新字段" };
  }

  // users 集合必须存在（通常由 authLogin 初始化）
  const userRes = await db.collection("users").where({ openid }).limit(1).get();
  if (!userRes.data || userRes.data.length === 0) {
    return { success: false, message: "用户不存在，请先重新登录" };
  }

  const user = userRes.data[0];
  const updateData = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (wechat !== undefined) updateData.wechat = wechat;

  await db.collection("users").doc(user._id).update({ data: updateData });

  return {
    success: true,
    data: {
      userId: user._id,
      openid: user.openid,
      role: user.role,
      groupId: user.groupId || 0,
      name: name !== undefined ? name : user.name || "",
      phone: phone !== undefined ? phone : user.phone || "",
      wechat: wechat !== undefined ? wechat : user.wechat || ""
    }
  };
};

