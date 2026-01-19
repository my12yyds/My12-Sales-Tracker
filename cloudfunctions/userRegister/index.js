const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function now() {
  return new Date();
}

function isValidCnMobile(phone) {
  return /^1\d{10}$/.test(phone);
}

/**
 * 用户注册（必须手机号 + 选择角色）
 * - role: 1 主播 / 2 销售
 * - 默认不分配小组：groupId = 0
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: "无法获取 openid" };

  try {
    const role = Number(event.role);
    const phone = String(event.phone || "").trim();
    const name = String(event.name || "").trim();

    if (![1, 2].includes(role)) {
      return { success: false, message: "请选择角色（主播/销售）" };
    }
    if (!isValidCnMobile(phone)) {
      return { success: false, message: "请输入正确的手机号" };
    }
    if (!name) {
      return { success: false, message: "请输入姓名" };
    }

    // 确保 users 集合存在
    try {
      await db.collection("users").limit(1).get();
    } catch (e) {
      if (e && (e.errCode === -502005 || e.code === "DATABASE_COLLECTION_NOT_EXIST")) {
        await db.createCollection("users");
      } else {
        throw e;
      }
    }

    // 已注册则直接返回（幂等）
    const existed = await db.collection("users").where({ openid }).limit(1).get();
    if (existed.data && existed.data.length > 0) {
      const u = existed.data[0];
      return {
        success: true,
        data: {
          userId: u._id,
          openid: u.openid,
          role: u.role,
          groupId: u.groupId || 0,
          name: u.name || u.phone || "",
          phone: u.phone || ""
        }
      };
    }

    const createdAt = now();
    const userDoc = {
      openid,
      role,
      groupId: 0, // 默认不分配小组
      name: name || phone, // 默认用手机号作为显示名称
      phone,
      wechat: "",
      createdAt,
      updatedAt: createdAt
    };

    const addRes = await db.collection("users").add({ data: userDoc });
    return {
      success: true,
      data: {
        userId: addRes._id,
        openid,
        role: userDoc.role,
        groupId: userDoc.groupId,
        name: userDoc.name,
        phone: userDoc.phone
      }
    };
  } catch (e) {
    console.error("注册失败:", e);
    return { success: false, message: "注册失败：" + (e.message || e.errMsg || "") };
  }
};

