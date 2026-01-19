const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 获取用户详情
 * - 管理员和本人可以看到手机号和微信号
 * - 其他人只能看到基本信息
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 1. 获取当前用户信息
    const currentUserRes = await db.collection('users').where({ openid }).get();
    if (currentUserRes.data.length === 0) {
      return { success: false, message: '用户不存在，请先登录' };
    }
    const currentUser = currentUserRes.data[0];

    // 2. 参数校验
    const { userId } = event;
    if (!userId) {
      return { success: false, message: '用户ID不能为空' };
    }

    // 3. 查询目标用户
    const targetUserRes = await db.collection('users').doc(userId).get();
    const targetUser = targetUserRes.data;
    if (!targetUser) {
      return { success: false, message: '用户不存在' };
    }

    // 4. 权限判断：管理员或本人可以看到手机号和微信号
    const isAdmin = currentUser.role === 0;
    const isSelf = currentUser._id === userId;
    const canSeePrivate = isAdmin || isSelf;

    // 5. 组装返回数据
    const userData = {
      _id: targetUser._id,
      name: targetUser.name || '',
      role: targetUser.role,
      groupId: targetUser.groupId || 0,
      createdAt: targetUser.createdAt,
      updatedAt: targetUser.updatedAt
    };

    if (canSeePrivate) {
      userData.phone = targetUser.phone || '';
      userData.wechat = targetUser.wechat || '';
    }

    return {
      success: true,
      data: userData
    };
  } catch (error) {
    console.error('获取用户详情失败:', error);
    return { success: false, message: '获取用户详情失败：' + error.message };
  }
};
