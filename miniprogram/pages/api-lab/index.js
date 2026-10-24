/**
 * API 实验室
 *
 * 教学演示页：把教程里讲的 API 做成可以点的按钮，点一下就能看到真实返回。
 *
 * 这个页面**没有挂到任何导航入口**，正常用户看不到。
 * 打开方式：开发者工具 → 工具栏「普通编译」下拉 → 添加编译模式 →
 *   启动页面填 pages/api-lab/index → 保存并编译。
 * 详见 docs/tutorial/00-导读与课程地图.md「API 实验室」一节。
 */

const STORAGE_PREFIX = 'api-lab:';

Page({
  data: {
    sdkVersion: '',
    platform: '',
    brand: '',
    network: '',
    stackDepth: 0,
    stackRoutes: [],
    storageKeys: [],
    outputTitle: '',
    output: '',
    busy: false,
    // 拨号演示：留空则不会真的拨号。想试就改成你自己的号码。
    dialTarget: ''
  },

  onLoad() {
    this.readEnv();
    this.refreshStorage();
  },

  onShow() {
    this.refreshStack();
  },

  /* ---------------- 环境信息 ---------------- */

  readEnv() {
    // wx.getSystemInfoSync 自基础库 2.20.1 起被拆分并标记废弃。
    // 这里做能力判断：新版本用新 API，旧版本回退到旧 API。
    // 这是小程序里处理「API 演进」的标准写法。
    const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();

    this.setData({
      sdkVersion: base.SDKVersion || '未知',
      platform: device.platform || '未知',
      brand: device.brand || '未知'
    });

    wx.getNetworkType({
      success: res => this.setData({ network: res.networkType }),
      fail: () => this.setData({ network: '读取失败' })
    });
  },

  refreshStack() {
    // getCurrentPages() 返回当前页面栈，长度就是层级
    const pages = getCurrentPages();
    this.setData({
      stackDepth: pages.length,
      stackRoutes: pages.map(page => page.route)
    });
  },

  /* ---------------- 交互反馈 ---------------- */

  toastSuccess() {
    wx.showToast({ title: '操作成功', icon: 'success' });
  },

  toastNone() {
    // 长文案必须用 icon: 'none'，否则文字会被图标挤掉
    wx.showToast({ title: '这是纯文字提示，可以放比较长的一句话', icon: 'none' });
  },

  loadingDemo() {
    wx.showLoading({ title: '加载中', mask: true });
    // 教学点：showLoading 必须配对 hideLoading，否则一直转圈
    setTimeout(() => {
      wx.hideLoading();
      // 教学点：hideLoading 必须在 showToast 之前，否则 toast 被浮层顶掉
      wx.showToast({ title: '已收起 loading', icon: 'none' });
    }, 1500);
  },

  modalDemo() {
    wx.showModal({
      title: 'showModal 演示',
      content: 'success 回调在「确定」和「取消」时都会触发，必须自己判断 res.confirm。',
      success: res => {
        this.print('showModal 返回值', {
          confirm: res.confirm === true,
          cancel: res.cancel === true
        });
      }
    });
  },

  actionSheetDemo() {
    wx.showActionSheet({
      itemList: ['第一项', '第二项', '第三项'],
      success: res => this.print('showActionSheet 返回值', { tapIndex: res.tapIndex }),
      // 用户点「取消」也走 fail，这是正常行为，不需要报错
      fail: () => this.print('showActionSheet 返回值', { 结果: '用户取消了（走 fail）' })
    });
  },

  /* ---------------- 本地存储 ---------------- */

  refreshStorage() {
    try {
      const { keys } = wx.getStorageInfoSync();
      this.setData({ storageKeys: keys.filter(key => key.startsWith(STORAGE_PREFIX)) });
    } catch (e) {
      this.setData({ storageKeys: [] });
    }
  },

  storageWrite() {
    const key = STORAGE_PREFIX + 'demo';
    const value = { at: new Date().toISOString(), note: '这条数据存在本机，卸载小程序就没了' };
    try {
      wx.setStorageSync(key, value);
      this.refreshStorage();
      this.print('setStorageSync 写入成功', { key, value });
    } catch (e) {
      wx.showToast({ title: '写入失败：' + e.message, icon: 'none' });
    }
  },

  storageRead() {
    const key = STORAGE_PREFIX + 'demo';
    try {
      const value = wx.getStorageSync(key);
      // 教学点：不存在时返回空字符串，不是 undefined，也不是 null
      this.print('getStorageSync 读取结果', {
        key,
        value: value === '' ? '（空字符串：说明这个 key 不存在）' : value
      });
    } catch (e) {
      wx.showToast({ title: '读取失败：' + e.message, icon: 'none' });
    }
  },

  storageRemove() {
    try {
      wx.removeStorageSync(STORAGE_PREFIX + 'demo');
      // 教学点：setData 是异步的，删完立刻读 this.data.storageKeys 会拿到旧值。
      // 这里重新查一次存储，而不是依赖 setData 之后的 data。
      const { keys } = wx.getStorageInfoSync();
      const remaining = keys.filter(key => key.startsWith(STORAGE_PREFIX));
      this.setData({ storageKeys: remaining });
      this.print('removeStorageSync 已删除', { '剩余 api-lab key': remaining });
    } catch (e) {
      wx.showToast({ title: '删除失败：' + e.message, icon: 'none' });
    }
  },

  /* ---------------- 设备能力 ---------------- */

  copyDemo() {
    // 这个 API 自带「内容已复制」提示，不需要再 showToast 一次
    wx.setClipboardData({ data: '这段文字来自 API 实验室的 setClipboardData 演示' });
  },

  callDemo() {
    const target = (this.data.dialTarget || '').trim();
    if (!target) {
      wx.showToast({ title: '请先在 pages/api-lab/index.js 里填 dialTarget', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: String(target),
      // 教学点：phoneNumber 必须是字符串；用户取消也走 fail
      fail: () => this.print('makePhoneCall 返回值', { 结果: '用户取消或号码无效（走 fail）' })
    });
  },

  /* ---------------- 云能力 ---------------- */

  async callCloud() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '调用中', mask: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'authLogin', data: {} });
      wx.hideLoading();
      // 教学点：业务数据在 res.result 里，外面还有 errMsg / requestID
      this.print('wx.cloud.callFunction 完整返回值', {
        注意: '业务数据在 result 里，不是 res 本身',
        result: res.result,
        errMsg: res.errMsg,
        requestID: res.requestID ? '（已省略）' : undefined
      });
    } catch (error) {
      wx.hideLoading();
      this.print('调用失败', { message: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },

  async queryDatabase() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '查询中', mask: true });
    try {
      const db = wx.cloud.database();
      // 教学点：field 白名单只下发这几个字段，不下发手机号
      const res = await db.collection('users')
        .field({ _id: true, name: true, role: true, groupId: true })
        .limit(2)
        .get();
      wx.hideLoading();
      this.print('前端直连数据库（受权限规则约束）', {
        说明: 'where 返回的 data 是数组；这里只查 2 条做演示',
        data: res.data,
        errMsg: res.errMsg
      });
    } catch (error) {
      wx.hideLoading();
      this.print('查询失败', {
        message: error.message,
        常见原因: '集合权限未开放给前端，或集合不存在（-502005）'
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  /* ---------------- 输出面板 ---------------- */

  print(title, payload) {
    let text;
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (e) {
      text = String(payload);
    }
    // 面板高度有限，超长内容截断并提示
    const limit = 1200;
    const truncated = text.length > limit;
    this.setData({
      outputTitle: title,
      output: truncated ? text.slice(0, limit) + '\n…（已截断）' : text
    });
    wx.pageScrollTo({ scrollTop: 99999, duration: 200 });
  },

  clearOutput() {
    this.setData({ outputTitle: '', output: '' });
  }
});
