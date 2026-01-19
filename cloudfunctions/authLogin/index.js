const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function now() {
  return new Date();
}

/**
 * 角色枚举：
 * 0 管理员（只读）
 * 1 主播
 * 2 销售
 *
 * 重要：不再自动创建用户。未注册用户会返回 needRegister=true
 */
exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: "无法获取 openid" };

  let existed;
  try {
    // 如果 users 集合不存在，这里会抛出 -502005 错误
    existed = await db.collection("users").where({ openid }).limit(1).get();
  } catch (e) {
    // 自动创建 users 集合作为首次初始化
    if (e && (e.errCode === -502005 || e.code === "DATABASE_COLLECTION_NOT_EXIST")) {
      await db.createCollection("users");
      existed = { data: [] };
    } else {
      console.error("查询 users 集合失败:", e);
      return { success: false, message: "用户初始化失败：" + (e.message || e.errMsg || "") };
    }
  }

  if (existed.data && existed.data.length > 0) {
    const u = existed.data[0];
    return {
      success: true,
      data: {
        userId: u._id,
        openid: u.openid,
        role: u.role,
        groupId: u.groupId || 0,
        name: u.name || "",
        phone: u.phone || ""
      }
    };
  }

  // 未注册用户：引导去注册页
  return {
    success: true,
    needRegister: true,
    data: {
      openid
    }
  };
};

