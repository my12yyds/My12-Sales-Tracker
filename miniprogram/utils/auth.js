/**
 * 登录并获取用户信息
 */
async function login(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  try {
    const app = getApp();
    // 如果已有用户信息且不强制刷新，直接返回
    if (app.globalData.user && !forceRefresh) {
      return app.globalData.user;
    }

    // 先尝试读取本地缓存（避免每次启动都调用云函数）
    if (!forceRefresh) {
      try {
        const cached = wx.getStorageSync("user");
        if (cached && cached.openid) {
          app.globalData.user = cached;
          return cached;
        }
      } catch (e) {}
    }

    const res = await wx.cloud.callFunction({ name: "authLogin", data: {} });
    if (!res?.result?.success) {
      throw new Error(res?.result?.message || "登录失败");
    }

    // 未注册：不缓存 user，直接返回标记
    if (res?.result?.needRegister) {
      return { needRegister: true, openid: res?.result?.data?.openid || "" };
    }

    const user = res.result.data;
    app.globalData.user = user;
    try {
      wx.setStorageSync("user", user);
    } catch (e) {}
    return user;
  } catch (error) {
    console.error("登录失败:", error);
    return null;
  }
}

function roleName(role) {
  if (role === 0) return "管理员";
  if (role === 1) return "主播";
  if (role === 2) return "销售";
  return "未知";
}

function getRolePermissions(role) {
  if (role === 0) {
    return "查看全量数据、删除线索、管理用户";
  } else if (role === 1) {
    return "录入线索、查看本组线索、分配销售、删除本组线索、添加跟进";
  } else if (role === 2) {
    return "查看分配线索、添加跟进记录、推进线索进程";
  }
  return "";
}

async function getUserByOpenid(openid) {
  const db = wx.cloud.database();
  const r = await db.collection("users").where({ openid }).limit(1).get();
  return r.data?.[0] || null;
}

module.exports = {
  login,
  roleName,
  getUserByOpenid,
  getRolePermissions
};

