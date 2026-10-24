# 05 交互反馈 API

> 本章涉及的 API：`wx.showToast`、`wx.showLoading`、`wx.hideLoading`、`wx.showModal`、`wx.showActionSheet`

小程序的提示类 API 只有四个，但用错的比例相当高。核心原因是一个**没有写在参数表里的事实**：`showToast` 和 `showLoading` 抢的是同一块原生浮层，会互相顶掉。

本章按「用哪个」和「怎么用对」两条线讲。

## 5.1 四个 API 怎么选

| 需求 | 用哪个 | 本项目的例子 |
| --- | --- | --- |
| 一句简短反馈，不需要用户确认 | `wx.showToast` | 「已添加」「加载失败」 |
| 操作需要几十毫秒到几秒，期间不该重复点 | `wx.showLoading` | 「处理中...」「删除中...」 |
| 需要用户明确同意/拒绝 | `wx.showModal` | 「删除后无法恢复，确定删除吗？」 |
| 从若干选项里选一个 | `wx.showActionSheet` | 「从本组成员里选一个人加入协作」 |

## 5.2 wx.showToast

```js
// miniprogram/utils/lead-page.js:109
wx.showToast({ title: '无法保存筛选偏好', icon: 'none' });
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 提示文字。**建议不超过 7 个汉字**，超长会显示不全 |
| `icon` | string | `success`（默认）/ `error` / `loading` / `none` |
| `duration` | number | 停留毫秒数，默认 1500。`icon: 'loading'` 时不生效，需要手动 `hideToast` |
| `mask` | boolean | 是否显示透明蒙层挡住点击，默认 false |

### 关于 icon 的选择

本项目全仓 64 处 `showToast`，绝大多数是 `icon: 'none'`。这不是偷懒，是刻意的：

```js
// miniprogram/pages/lead-detail/index.js:177
wx.showToast({ title: '本组销售已全部分配', icon: 'none' });
```

`icon: 'success'` 会显示一个对勾图标，语义是「操作成功」。上面这句是**提示信息**不是成功反馈，用对勾会让人误以为「分配成功了」。同理，`icon: 'error'` 配一个红叉，用在「本组已全部分配」上也很怪。

**经验规则**：只有「操作确实成功/确实失败」才用 `success`/`error`，其余一律 `none`。

### 关于 title 长度

`icon` 不为 `none` 时，文字区域宽度会被图标挤占，实测超过 7 个汉字就开始显示不全。本项目里带图标的那几条都很短：

```js
wx.showToast({ title: action === 'add' ? '已添加' : '已移除', icon: 'success' });
```

而长文案一律 `icon: 'none'`，能用满整行宽度：

```js
wx.showToast({ title: '当前微信版本不支持文件分享', icon: 'none' });
```

## 5.3 showLoading / hideLoading：必须配对

```js
// miniprogram/pages/lead-detail/index.js:209-224
async assignSales(salesIds, action) {
  this.setData({ assigning: true });
  wx.showLoading({ title: '处理中...' });
  try {
    const res = await wx.cloud.callFunction({
      name: 'leadAssignSales',
      data: { leadId: this.data.leadId, salesIds, action }
    });
    wx.hideLoading();
    if (!res.result || !res.result.success) {
      throw new Error((res.result && res.result.message) || '操作失败');
    }
    wx.showToast({ title: action === 'add' ? '已添加' : '已移除', icon: 'success' });
    await this.loadData();
  } catch (error) {
    wx.hideLoading();
    wx.showToast({ title: error.message || '操作失败', icon: 'none' });
  } finally {
    this.setData({ assigning: false });
  }
}
```

### 铁律一：showLoading 和 hideLoading 必须成对出现

漏掉 `hideLoading`，那个转圈会一直挂在屏幕上，用户以为小程序卡死，只能杀掉重进。

### 铁律二：hideLoading 必须在 showToast 之前

这是最容易忽略的一条。因为 `showToast` 和 `showLoading` **共用同一个原生浮层**：

```js
// ❌ 错：loading 把 toast 顶掉，用户什么都看不到
wx.showLoading({ title: '处理中...' });
await doSomething();
wx.showToast({ title: '完成', icon: 'success' });   // 屏幕上还是「处理中...」

// ✅ 对：先收 loading 再弹 toast
wx.showLoading({ title: '处理中...' });
await doSomething();
wx.hideLoading();
wx.showToast({ title: '完成', icon: 'success' });
```

上面 `assignSales` 的写法就是对的：`hideLoading()` 紧跟在 `await` 后面，在 `showToast` 之前。

### 铁律三：`mask: true` 配合 loading 防重复点击

`wx.showLoading` 默认**不挡点击**。用户手快连点三次，就会发三次请求。

本项目的做法是双保险：

```js
if (this.data.assigning) return;          // ① 状态位拦截
this.setData({ assigning: true });
wx.showLoading({ title: '处理中...' });
```

① 那个状态位判断比 `mask` 更可靠，因为它拦在逻辑层，而 `mask` 只是挡住触摸事件。`mask` 在这里其实没传，靠状态位就够了。

### 一处可以更好的写法

上面那段在 `try` 里调了一次 `hideLoading()`，`catch` 里又调一次。功能上没问题（重复调用是无害的空操作，最多在控制台看到警告），但逻辑重复了。更干净的写法是只放在 `finally`：

```js
wx.showLoading({ title: '处理中...' });
try {
  // ...
} catch (error) {
  // ...
} finally {
  wx.hideLoading();     // 无论成功失败都收，且只写一次
  this.setData({ assigning: false });
}
```

**为什么本项目没那么写？** 因为如果放 `finally`，`showToast` 在 `try`/`catch` 里就已经弹了，而 `hideLoading` 要等到 `finally` 才执行——顺序反了，toast 会被顶掉。所以要么把 toast 也挪到 `finally` 之后，要么就像现在这样在每条路径上手动收。

这是 `showToast` 与 `showLoading` 抢浮层带来的连带复杂度。写的时候想清楚执行顺序，比记住某个模板更重要。

## 5.4 wx.showModal：需要用户确认

```js
// miniprogram/utils/lead-page.js:150
wx.showModal({
  title: '确认删除',
  content: '删除后无法恢复，确定删除这条线索吗？',
  success: async res => {
    if (!res.confirm) return;
    try {
      const result = await wx.cloud.callFunction({ name: 'leadDelete', data: { leadId } });
      if (!result.result.success) throw new Error(result.result.message);
      await this.loadLeads();
    } catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }); }
  }
});
```

| 参数 | 说明 |
| --- | --- |
| `title` | 标题 |
| `content` | 正文 |
| `showCancel` | 是否显示取消按钮，默认 true |
| `cancelText` / `confirmText` | 按钮文案，默认「取消」「确定」 |
| `success` | 回调，`res.confirm` 为 true 表示点了确定，`res.cancel` 为 true 表示点了取消 |
| `fail` | 调用失败（极少触发） |

### 三个要点

**第一，`success` 回调在「用户点了按钮」和「用户点了取消」时都会触发。** 所以必须判 `res.confirm`。漏掉这个判断，用户点取消也会执行删除。

**第二，回调里可以写 `async`。** 上面那个 `success: async res => {...}` 是合法的，因为小程序不关心回调返回什么。但要注意：**`showModal` 本身不返回 Promise**，所以不能用 `const res = await wx.showModal(...)` 这种写法（新版基础库部分 API 支持 Promise 化，但 `showModal` 的兼容性不稳，本项目统一用回调）。

**第三，弹窗期间页面还在，可以正常操作。** 不像 `showLoading` 会挡住点击，`showModal` 有独立的遮罩，用户只能点按钮。所以它适合放「不可逆操作」的确认。

本项目的删除操作就是标准范式：`showModal` 确认 → `callFunction` → 成功刷新列表 / 失败 toast。

## 5.5 wx.showActionSheet：从列表里选一个

```js
// miniprogram/pages/lead-detail/index.js:173-190
onAddAssign() {
  if (this.data.assigning) return;
  const candidates = this.candidates();
  if (candidates.length === 0) {
    wx.showToast({ title: '本组销售已全部分配', icon: 'none' });
    return;
  }
  wx.showActionSheet({
    itemList: candidates.slice(0, 6).map(s => s.name),
    success: res => {
      const target = candidates[res.tapIndex];
      if (target) this.assignSales([target._id], 'add');
    },
    fail: () => {}
  });
}
```

| 参数 | 说明 |
| --- | --- |
| `itemList` | 字符串数组，**最多 6 项**，超过会报错 |
| `itemColor` | 文字颜色 |
| `success` | 回调，`res.tapIndex` 是被点项的**下标**（从 0 开始） |
| `fail` | 用户点「取消」或点遮罩时触发 |

### 要点

**`itemList` 最多 6 项。** 这是硬限制。所以代码里必须 `slice(0, 6)`，否则成员超过 6 人时整个弹窗直接报错。

**返回的是下标不是值。** `res.tapIndex` 是数字，要自己回数组里取：

```js
const target = candidates[res.tapIndex];
```

**必须判断 `target` 是否存在。** `slice(0, 6)` 截断后，`tapIndex` 一定在 0~5 之间，理论上有值；但用户可能在弹窗打开期间点了别的操作导致 `candidates` 变了（虽然这个页面里不会）。防御性判断 `if (target)` 是低成本的好习惯。

**取消时走 `fail` 不是 `success`。** 这点和 `showModal` 不同——`showModal` 取消会走 `success` 且 `res.cancel === true`，`showActionSheet` 取消直接走 `fail`。所以 `fail: () => {}` 那个空函数不是没写完，是**故意吞掉「用户取消」这个正常行为**，避免控制台一片红。

## 5.6 一个跨页面的坑

`wx.showToast` 在**页面跳转时会立即消失**。所以这个写法是错的：

```js
// ❌ 错：toast 弹出来，同时页面已经在跳转，用户看不到
wx.showToast({ title: '保存成功', icon: 'success' });
wx.navigateTo({ url: '/pages/lead-detail/index' });
```

正确做法是把提示交给**目标页面**去弹（比如在目标页 `onLoad` 里判断某个标记），或者接受「不提示」，靠页面内容本身说明结果。

本项目没有这个问题，因为所有 toast 都在当前页面操作完成后弹出，不伴随跳转。但如果你要加「保存后返回列表并提示」，就会撞上这个坑。

## 5.7 练习

1. **复现浮层冲突**：把 `assignSales` 里的 `wx.hideLoading()` 删掉，在真机/模拟器里操作一次，确认只看到「处理中...」而看不到「已添加」。
2. **复现 modal 漏判**：把删除确认里的 `if (!res.confirm) return;` 删掉，点「取消」，看线索是不是被删了。**记得用测试数据。**
3. **验证 6 项上限**：给 `showActionSheet` 传 7 个 `itemList`，看报什么错。
4. **改造 loading 顺序**：把 `assignSales` 改成「所有 `hideLoading` 集中到 `finally`」，同时把 `showToast` 也移到 `finally` 之后，确认提示能正常显示。这是比原写法更清晰的结构。

---

上一篇：[04 查询指令与分页上限](04-查询指令与分页上限.md) · 下一篇：[06 页面路由与参数传递](06-页面路由与参数传递.md)
