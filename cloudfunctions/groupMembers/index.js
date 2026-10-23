const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 列出某小组的销售，供「协作销售」分配使用。
 * - 主播：只能查看自己所在组
 * - 管理员：需显式传 groupId
 * 只返回 _id 与姓名，不下发手机号/微信号。
 */
exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const userRes = await db.collection('users').where({ openid }).limit(1).get();
    if (userRes.data.length === 0) {
      return { success: false, message: '用户不存在，请先登录' };
    }
    const user = userRes.data[0];

    let groupId;
    if (user.role === 1) {
      groupId = user.groupId;
    } else if (user.role === 0) {
      groupId = event.groupId;
    } else {
      return { success: false, message: '无权限查看小组成员' };
    }

    if (![1, 2, 3, 4].includes(groupId)) {
      return { success: false, message: '小组无效，请先联系管理员分配小组' };
    }

    const salesRes = await db.collection('users')
      .where({ role: 2, groupId })
      .field({ _id: true, name: true })
      .limit(200)
      .get();

    const list = (salesRes.data || [])
      .map(item => ({ _id: item._id, name: item.name || '未命名' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    return {
      success: true,
      data: { groupId, list, total: list.length }
    };
  } catch (error) {
    console.error('获取小组成员失败:', error);
    return { success: false, message: '获取小组成员失败：' + error.message };
  }
};
