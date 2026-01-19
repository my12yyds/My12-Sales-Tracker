const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 删除线索（主播/管理员）
 * - 主播：只能删除本组的线索
 * - 管理员：可以删除所有线索
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 1. 获取用户信息
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) {
      return { success: false, message: '用户不存在，请先登录' };
    }
    const user = userRes.data[0];
    const { _id: userId, role, groupId } = user;

    // 2. 权限校验：只有主播或管理员可以删除线索
    if (role !== 1 && role !== 0) {
      return { success: false, message: '只有主播或管理员可以删除线索' };
    }

    // 3. 参数校验
    const { leadId } = event;
    if (!leadId) {
      return { success: false, message: '线索ID不能为空' };
    }

    // 4. 查询线索
    const leadRes = await db.collection('leads').doc(leadId).get();
    const lead = leadRes.data;
    if (!lead) {
      return { success: false, message: '线索不存在' };
    }

    // 5. 权限校验：主播只能删除本组线索
    if (role === 1 && lead.groupId !== groupId) {
      return { success: false, message: '只能删除本组线索' };
    }

    // 6. 删除该线索的所有跟进记录
    const followUpsRes = await db.collection('followUps')
      .where({ leadId })
      .get();
    
    if (followUpsRes.data.length > 0) {
      // 使用 Promise.all 批量删除
      const deletePromises = followUpsRes.data.map(followUp => 
        db.collection('followUps').doc(followUp._id).remove()
      );
      await Promise.all(deletePromises);
    }

    // 7. 删除线索
    await db.collection('leads').doc(leadId).remove();

    return {
      success: true,
      message: '删除成功'
    };
  } catch (error) {
    console.error('删除线索失败:', error);
    return { success: false, message: '删除线索失败：' + error.message };
  }
};
