# 09 WXML 数据绑定与事件

> 本章涉及的 API：`wx:if`、`wx:elif`、`wx:else`、`wx:for`、`wx:key`、`bindtap`、`bindinput`、`bindchange`、`bindconfirm`、`data-*`

WXML 是小程序的模板语言，长得像 HTML，但有三处本质不同：**表达式能力有限、事件系统自己一套、没有 DOM 操作**。

本章以 `templates/lead-list.wxml` 为主线——这一个文件就覆盖了列表页需要的全部 WXML 特性。

## 9.1 数据绑定：{{ }}

双大括号里可以写**表达式**，但不能写语句：

```html
<!-- ✅ 表达式：三元、逻辑运算、属性访问、函数调用（有限） -->
<text>{{isAnchor ? '本团队线索' : '我的线索'}}</text>
<text>{{userName || '加载中'}}</text>
<text>{{item.followUpCount || 0}}</text>

<!-- ❌ 语句：不能写 if/for/赋值 -->
<text>{{ if (a) { return b } }}</text>
```

### 支持的操作符

| 类型 | 例子 | 出处 |
| --- | --- | --- |
| 三元 | `{{isAnchor ? '负责人' : '成员'}}` | `lead-list.wxml:6` |
| 逻辑或（取默认值） | `{{userName \|\| '加载中'}}` | `lead-list.wxml:6` |
| 逻辑与（条件渲染） | `{{item.customerName && item.phone}}` | `lead-list.wxml:44` |
| 属性访问 | `{{statusOptions[statusIndex].label}}` | `lead-list.wxml:14` |
| 算术 | `{{a + b}}` | — |

**`||` 做默认值是 WXML 里最常用的技巧**。`{{item.followUpCount || 0}}` 的意思是「有值就用，`null`/`undefined`/`0`/`''` 都当假值」。注意这里 `0` 也会被替换成 `0`，看起来没区别，但如果写成 `{{item.followUpCount || '-'}}`，`0` 就会显示成 `-`——**这是 `||` 的经典陷阱**，想区分「0」和「没值」要用 `{{item.followUpCount == null ? '-' : item.followUpCount}}`。

### 动态 class

```html
<text wx:if="{{item.dueText}}" class="tag-due tag-due-{{item.dueLevel}}">{{item.dueText}}</text>
<text class="tag-status tag-{{item.lastStatus || item.status}}">{{item.lastStatusText}}</text>
```

`class` 里可以混写静态和动态部分。上面第二行会根据状态拼出 `tag-status tag-NEW`、`tag-status tag-WON` 这样的类名，WXSS 里对应写 `.tag-NEW { ... }` 就能给不同状态上不同颜色。

**这个技巧比 `style` 内联好**，因为样式规则留在 WXSS 里，改颜色不用动结构。

## 9.2 条件渲染：wx:if / wx:elif / wx:else

```html
<!-- 单个条件 -->
<button wx:if="{{isAnchor}}" class="btn-success" size="mini" bindtap="onAddLead">录入线索</button>

<!-- 条件 + 兜底 -->
<view wx:if="{{error}}" class="card error-box"><text>{{error}}</text><button size="mini" bindtap="onRefresh">重试</button></view>
<view class="empty" wx:if="{{!leads.length && !loading && !error}}">没有符合筛选条件的线索</view>
```

### wx:if 和 hidden 的区别

| | `wx:if` | `hidden` |
| --- | --- | --- |
| 不满足时 | 节点**不渲染**（从树里移除） | 节点渲染但 `display: none` |
| 切换成本 | 高（销毁/重建组件） | 低（改样式） |
| 初始渲染 | 不满足就不创建 | 总创建 |

**规则**：频繁切换用 `hidden`，条件基本不变用 `wx:if`。

本项目全用 `wx:if`，因为列表项的状态（有没有电话、有没有备注）在渲染后基本不会变。

### 一个容易忽略的坑：wx:if 里的表达式在数据未就绪时会报错

```html
<!-- data.lead 为 null 时，访问 lead.groupId 会报错 -->
<view wx:if="{{lead.groupId > 0}}">...</view>
```

WXML 的表达式求错不会让页面崩溃（只是渲染不出来），但控制台会有警告。安全写法：

```html
<view wx:if="{{lead && lead.groupId > 0}}">...</view>
```

本项目在 `lead-detail/index.wxml` 里大量使用 `{{lead.xxx}}`，是因为页面加载时 `data.lead` 初始化为 `{}` 而不是 `null`，所以属性访问不会报错。**初始化 `data` 时给个空对象，比给 `null` 省很多麻烦。**

## 9.3 列表渲染：wx:for

```html
<view class="card lead-card" wx:for="{{leads}}" wx:key="_id">
  <view bindtap="onLeadTap" data-id="{{item._id}}">
    <text class="phone lead-card-name">{{item.customerName || item.phone || '未命名事项'}}</text>
    ...
  </view>
</view>
```

默认变量名是 `item`（当前项）和 `index`（下标）。可以改名：

```html
<view wx:for="{{leads}}" wx:for-item="lead" wx:for-index="i" wx:key="_id">
  {{lead.customerName}}
</view>
```

### wx:key 不是可选的

`wx:key` 告诉框架「用什么字段唯一标识这一项」。它影响两件事：

1. **列表更新时的复用策略**：有 key 时框架知道哪些项没变，只更新变化的；没 key 时按位置对比，插入一条会导致后面全部重渲染；
2. **组件内部状态**：如果列表项里包含有内部状态的组件（比如输入框），没 key 会导致状态错位。

**两种写法**：

```html
<!-- 用数据里的唯一字段（推荐） -->
<view wx:for="{{leads}}" wx:key="_id">

<!-- 用项本身（前提是项是字符串或数字） -->
<view wx:for="{{items}}" wx:key="*this">
```

`wx:key` 的值**不加双大括号**，直接写字段名。写成 `wx:key="{{item._id}}"` 是错的。

本项目所有 `wx:for` 都用了 `_id`，因为数据来自数据库，天然有唯一 ID。这是个好习惯——**列表数据一定要有稳定唯一键**，临时拼的数组用下标当 key 很容易出问题。

## 9.4 事件绑定

### 五种绑定方式

| 写法 | 触发时机 | 本项目例子 |
| --- | --- | --- |
| `bindtap` | 点击 | `bindtap="onLeadTap"` |
| `bindinput` | 输入（每次按键） | `bindinput="onKeywordInput"` |
| `bindchange` | 值变化后（失焦/选择） | `bindchange="onStatusChange"` |
| `bindconfirm` | 键盘「完成/搜索」 | `bindconfirm="onSearch"` |
| `catchtap` | 点击且阻止冒泡 | 本项目未使用 |

`bind` 和 `catch` 的区别：`catch` 会阻止事件冒泡。本项目没有嵌套点击场景，所以全用 `bind`。

### bindinput vs bindchange

这是表单里最容易搞混的一对：

```html
<input value="{{keyword}}" bindinput="onKeywordInput" bindconfirm="onSearch" confirm-type="search" />
```

- `bindinput` **每敲一个字都触发**，适合做实时预览（本项目用它同步 `keyword` 到 data）；
- `bindchange` **在失焦或确认时才触发**，适合做「值定了再查询」。

本项目 `keyword` 用 `bindinput` 同步值，但**不在 input 里查库**——查库放在 `bindconfirm`（用户按搜索键）或点击搜索按钮时。这是对的：如果每敲一个字就请求一次，10 个字的搜索会发 10 次请求。

```js
// miniprogram/utils/lead-page.js:112
onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
onSearch() { return this.loadLeads(); },
```

`onKeywordInput` 只更新 data，不触发查询。`onSearch` 才查。**职责分离，各干一件事。**

### confirm-type

```html
confirm-type="search"
```

把键盘右下角的按钮文字改成「搜索」，并让 `bindconfirm` 在按下时触发。可选值：`send`、`search`、`next`、`go`、`done`。

移动端用户习惯用键盘的「搜索」键，加这个属性能提升体验，成本几乎为零。

## 9.5 data-* 与 dataset：事件怎么带参数

WXML 里不能直接给事件处理函数传参（`bindtap="onLeadTap(id)"` 是无效的）。标准做法是把数据挂在 `data-*` 属性上：

```html
<view bindtap="onLeadTap" data-id="{{item._id}}">
```

JS 里通过 `e.currentTarget.dataset` 取：

```js
// miniprogram/utils/lead-page.js:124
onLeadTap(e) {
  wx.navigateTo({ url: '/pages/lead-detail/index?leadId=' + encodeURIComponent(e.currentTarget.dataset.id) });
}
```

### 命名转换规则

`data-*` 里的**连字符会转成驼峰**：

| WXML 属性 | dataset 里的 key |
| --- | --- |
| `data-id` | `dataset.id` |
| `data-phone` | `dataset.phone` |
| `data-lead-id` | `dataset.leadId` |
| `data-user-name` | `dataset.userName` |

本项目用的是单词属性（`data-id`、`data-phone`、`data-mode`、`data-due`），所以取的时候直接 `.id`、`.phone`。

### e.target vs e.currentTarget

这是事件对象里最容易搞错的一对：

```html
<view bindtap="onLeadTap" data-id="{{item._id}}">
  <text>客户名称</text>          <!-- 用户可能点这里 -->
  <text>电话</text>
</view>
```

用户点的是内部的 `<text>`，事件会**冒泡**到外层 `<view>`。

- `e.target`：**实际被点的元素**（那个 `<text>`），它的 `dataset` 是空的；
- `e.currentTarget`：**绑定事件的那个元素**（外层 `<view>`），它的 `dataset` 才有 `id`。

**所以取 dataset 永远用 `e.currentTarget.dataset`。** 本项目所有事件处理都遵守这一点：

```js
// miniprogram/pages/lead-detail/index.js:192
const { id, name } = e.currentTarget.dataset;
```

用错成 `e.target.dataset` 的症状是：点卡片边缘能进详情，点卡片中间的文字没反应——因为点文字时 `target` 是 `<text>`，没有 `data-id`。

## 9.6 模板复用：include

两个列表页（负责人 / 成员）的 WXML 完全一样：

```html
<!-- miniprogram/pages/anchor/leads/index.wxml 全文 -->
<include src="../../../templates/lead-list.wxml" />
```

```html
<!-- miniprogram/pages/sales/leads/index.wxml 全文 -->
<include src="../../../templates/lead-list.wxml" />
```

`<include>` 把目标文件的**内容**（不含 `<template>` 和 `<wxs>` 标签）原样嵌入。配合 `Page(createLeadPage(isAnchor))` 的工厂函数（[第 01 章](01-项目结构与生命周期.md) 1.4），页面逻辑和结构都复用了一份。

另一种复用方式是 `<template>` + `<import>`，它可以定义带参数的模板片段：

```html
<!-- 定义 -->
<template name="leadTag">
  <text class="tag">{{statusText}}</text>
</template>

<!-- 使用 -->
<import src="../../../templates/tag.wxml" />
<template is="leadTag" data="{{statusText: item.lastStatusText}}" />
```

**怎么选？**

- 整个文件结构一样 → `include`（本项目用的）
- 只有某个片段重复、需要传参 → `template` + `import`

本项目没有需要传参的重复片段，所以只用 `include`。

## 9.7 一个完整的读法示例

把上面所有知识点串起来，读这一段：

```html
<view class="card lead-card" wx:for="{{leads}}" wx:key="_id">
  <view bindtap="onLeadTap" data-id="{{item._id}}">
    <text class="phone lead-card-name">{{item.customerName || item.phone || '未命名事项'}}</text>
    <text wx:if="{{item.dueText}}" class="tag-due tag-due-{{item.dueLevel}}">{{item.dueText}}</text>
    <text class="tag-status tag-{{item.lastStatus || item.status}}">{{item.lastStatusText}}</text>
  </view>
  <button wx:if="{{item.phone}}" size="mini" bindtap="onCall" data-phone="{{item.phone}}">拨号</button>
</view>
```

逐行翻译成人话：

1. 遍历 `data.leads`，用 `_id` 作为唯一键；
2. 整个卡片区域可点击，把 `_id` 挂到 `data-id`；
3. 名称优先级：客户名称 → 电话 → 「未命名事项」（三级兜底，因为这两个字段都可能为空）；
4. 只有存在 `dueText`（待跟进提示）时才渲染那个标签，类名带上 `dueLevel`（`normal`/`warn`/`overdue`）决定颜色；
5. 状态标签的类名由状态值拼出来，`lastStatus` 优先（兼容历史数据只有 `status` 的情况）；
6. 拨号按钮只在有电话时出现，电话通过 `data-phone` 传给 `onCall`。

**这六条里有四条是「防御性渲染」**：字段可能为空、可能是旧格式。文档型数据库没有 schema，前端必须假设每个字段都可能缺失。

## 9.8 练习

1. **复现 e.target 的坑**：把 `onLeadTap` 里的 `e.currentTarget.dataset` 改成 `e.target.dataset`，在列表里点卡片中间的文字，观察是否还能跳转。
2. **去掉 wx:key**：删掉列表的 `wx:key="_id"`，在列表顶部插一条数据，用调试器的 WXML 面板看渲染节点的变化数量。
3. **区分 || 与 == null**：把 `{{item.followUpCount || 0}}` 改成 `{{item.followUpCount || '-'}}`，找一条 `followUpCount` 为 0 的线索，看显示成什么。
4. **加一个 wx:elif**：给列表加「今日待跟进」高亮，用 `wx:if / wx:elif / wx:else` 实现三种状态（逾期/今日/正常）的标签颜色。

---

上一篇：[08 设备能力与文件导出](08-设备能力与文件导出.md) · 下一篇：[10 表单组件与选择器](10-表单组件与选择器.md)
