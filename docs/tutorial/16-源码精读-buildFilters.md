# 16 源码精读：buildFilters 的 87 行

> 上一章跟着请求走了一遍。这一章停下来，只读一个文件：`cloudfunctions/leadList/filters.js`。

87 行，5 个函数，是整个项目里**信息密度最高**的一段代码。它把「用户在筛选面板上的操作」翻译成「数据库能执行的查询条件」，中间隔着类型校验、时区处理、正则转义、条件组合。

读懂它，等于读懂了「业务参数 → 数据查询」这类代码的通用套路。

## 16.1 为什么单独精读它

三个理由：

1. **它是唯一一个「纯函数」模块**。不碰数据库、不碰网络、不依赖 SDK 之外的任何东西，输入输出完全确定。所以它有 4 个测试文件覆盖，改一行就能立刻验证。
2. **它承担了全部参数校验**。`leadList` 的 `event` 从这里进来，非法值在这里被拦住。它是这个接口的「安检门」。
3. **它的坑最多**。时间区间覆盖、时区、正则注入、排序注入、日期字符串比较——每个坑单独讲都够一章，这里全挤在 87 行里。

## 16.2 全貌

```js
// cloudfunctions/leadList/filters.js（完整 87 行）
const SORTS = {
  newest: ['createdAt', 'desc'], oldest: ['createdAt', 'asc'],
  recent: ['lastFollowUpAt', 'desc'], mostFollowed: ['followUpCount', 'desc']
};

// Closed deals no longer need a follow-up reminder.
const TERMINAL_STATUSES = ['WON', 'LOST'];
const DUE_OPTIONS = ['', 'today', 'overdue', 'week'];
const DAY_MS = 86400000;

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期须为 YYYY-MM-DD');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  // UI dates represent calendar days in China, independent of server timezone.
  return new Date(value + 'T00:00:00+08:00');
}

/**
 * China calendar day for "now", independent of the server timezone.
 * Cloud functions may run in UTC, so local getDate() must not be used here.
 */
function chinaToday(now) {
  const timestamp = now === undefined ? Date.now() : now;
  const shifted = new Date(timestamp + 8 * 3600000);
  if (!Number.isFinite(shifted.getTime())) throw new Error('当前时间无效');
  return shifted.toISOString().slice(0, 10);
}

/**
 * Build the "pending follow-up" conditions.
 * today   : planned date is today
 * overdue : planned date is before today
 * week    : planned date is within the next 7 days (today included)
 */
function dueConditions(db, due, today) {
  if (due === undefined || due === '') return [];
  if (typeof due !== 'string' || !DUE_OPTIONS.includes(due)) throw new Error('待跟进筛选无效');
  const start = day(today);
  const conditions = [];
  if (due === 'today') {
    conditions.push({ nextFollowUpAt: db.command.gte(start) });
    conditions.push({ nextFollowUpAt: db.command.lt(new Date(start.getTime() + DAY_MS)) });
  } else if (due === 'week') {
    conditions.push({ nextFollowUpAt: db.command.gte(start) });
    conditions.push({ nextFollowUpAt: db.command.lt(new Date(start.getTime() + 7 * DAY_MS)) });
  } else {
    conditions.push({ nextFollowUpAt: db.command.lt(start) });
  }
  // Historic leads may carry status but no lastStatus.
  conditions.push(db.command.or([
    { lastStatus: db.command.nin(TERMINAL_STATUSES) },
    { lastStatus: db.command.exists(false), status: db.command.nin(TERMINAL_STATUSES) }
  ]));
  return conditions;
}

function buildFilters(db, scope, event, options = {}) {
  const conditions = [scope];
  const sortKey = event.sort === undefined ? 'newest' : event.sort;
  if (typeof sortKey !== 'string' || !Object.prototype.hasOwnProperty.call(SORTS, sortKey)) throw new Error('排序选项无效');
  if (event.leadId !== undefined) {
    if (typeof event.leadId !== 'string' || !event.leadId.trim()) throw new Error('线索ID无效');
    conditions.push({ _id: event.leadId });
  }
  if (event.keyword !== undefined && typeof event.keyword !== 'string') throw new Error('关键词须为文本');
  const keyword = (event.keyword || '').trim();
  if (keyword.length > 80) throw new Error('关键词最多80个字符');
  if (keyword) {
    const literal = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    conditions.push(db.command.or([
      { phone: db.RegExp({ regexp: literal, options: 'i' }) },
      { customerName: db.RegExp({ regexp: literal, options: 'i' }) },
      { remarks: db.RegExp({ regexp: literal, options: 'i' }) }
    ]));
  }
  if (event.createdFrom) conditions.push({ createdAt: db.command.gte(day(event.createdFrom)) });
  if (event.createdTo) conditions.push({ createdAt: db.command.lt(new Date(day(event.createdTo).getTime() + 86400000)) });
  if (event.createdFrom && event.createdTo && event.createdFrom > event.createdTo) throw new Error('开始日期不能晚于结束日期');
  if (event.unfollowed !== undefined && typeof event.unfollowed !== 'boolean') throw new Error('未跟进选项须为布尔值');
  if (event.unfollowed) conditions.push(db.command.or([{ followUpCount: 0 }, { followUpCount: db.command.exists(false) }]));
  const today = options.today === undefined ? chinaToday() : options.today;
  const due = dueConditions(db, event.due, today);
  due.forEach(condition => conditions.push(condition));
  return { query: conditions.length === 1 ? scope : db.command.and(conditions), order: SORTS[sortKey] };
}
module.exports = { buildFilters, SORTS, day, dueConditions, chinaToday, TERMINAL_STATUSES, DUE_OPTIONS };
```

## 16.3 五个函数的分工

| 函数 | 职责 | 纯函数？ | 依赖 |
| --- | --- | --- | --- |
| `SORTS` | 排序白名单 | — | 无 |
| `day(value)` | 把 `'YYYY-MM-DD'` 转成中国时区的 `Date` | ✅ | 无 |
| `chinaToday(now)` | 拿「中国日历日的今天」 | ✅ | 无（`now` 可注入） |
| `dueConditions(db, due, today)` | 生成待跟进相关条件 | 近似（要 `db.command`） | `db` |
| `buildFilters(db, scope, event, options)` | 汇总所有条件 + 排序 | 近似 | `db` |

**注意 `db` 是参数而不是模块级变量。** 这一点很关键：如果写成 `const db = cloud.database()` 放在文件顶部，这个模块就只能跑在云函数环境里，测试时必须伪造整个 SDK。

现在这样，测试可以传一个假的 `db`：

```js
// tests/lead-filters.test.js:5-7
const db = { command: {}, RegExp: value => ({ regex: value }) };
for (const key of ['and', 'or', 'gte', 'lt', 'exists']) db.command[key] = value => ({ [key]: value });
const scope = { groupId: 2, assignedSalesIds: 'sales' };
```

七行就造出了一个「只记录不执行」的数据库。`db.command.gte(x)` 返回 `{ gte: x }`，于是测试可以断言最终条件长什么样：

```js
// tests/lead-filters.test.js:20-23
test('China calendar date range includes whole end day', () => {
  const { query } = buildFilters(db, scope, { createdFrom: '2026-10-01', createdTo: '2026-10-22' });
  assert.equal(query.and[1].createdAt.gte.toISOString(), '2026-09-30T16:00:00.000Z');
  assert.equal(query.and[2].createdAt.lt.toISOString(), '2026-10-22T16:00:00.000Z');
```

注意 `2026-09-30T16:00:00.000Z` 这个断言——它是 `2026-10-01 00:00 +08:00` 的 UTC 表示。测试直接把「中国零点」这个语义固定下来了。

`due-filters.test.js` 的替身多一个 `nin`（`dueConditions` 用到），少一个 `RegExp`（那个文件不测关键词）。**替身是按需长出来的，不需要一次写全。**

**「把依赖当参数传」是让代码可测试最有效的手段**，比 mock 框架简单得多。

## 16.4 SORTS：为什么不能用前端传来的字段名

```js
const SORTS = {
  newest: ['createdAt', 'desc'], oldest: ['createdAt', 'asc'],
  recent: ['lastFollowUpAt', 'desc'], mostFollowed: ['followUpCount', 'desc']
};
```

前端传的是 `'newest'` 这样的**语义 key**，不是 `'createdAt'` 这样的**字段名**。

如果直接写 `.orderBy(event.sort, event.order)`，会发生三件事：

1. **报错泄露结构**：传个不存在的字段，数据库报错信息里可能带出可用字段名；
2. **排序错乱**：传 `'_openid'` 之类的内部字段，能把不该暴露的信息变成可推断的排序依据；
3. **性能问题**：对没建索引的字段排序，大数据量下会超时。

用白名单后，非法值在入口就被拦住：

```js
const sortKey = event.sort === undefined ? 'newest' : event.sort;
if (typeof sortKey !== 'string' || !Object.prototype.hasOwnProperty.call(SORTS, sortKey)) throw new Error('排序选项无效');
```

### 为什么用 `hasOwnProperty` 而不是 `SORTS[sortKey]`

```js
if (!SORTS[sortKey]) throw ...            // ❌ 有原型链问题
if (!Object.prototype.hasOwnProperty.call(SORTS, sortKey)) throw ...  // ✅
```

因为 `SORTS['constructor']`、`SORTS['toString']` 都是真值——它们来自 `Object.prototype`。如果不加 `hasOwnProperty`，传 `sort=constructor` 能通过校验，然后 `.orderBy('undefined', ...)` 或者更奇怪的行为。

这是 **prototype pollution 类的经典坑**。虽然这个场景危害有限（拿不到原型上的有效排序值），但写法上必须严格——**白名单校验一律用 `hasOwnProperty` 或 `Object.hasOwn`**。

项目里有专门的用例守着这条：

```js
// tests/lead-filters.test.js:16-18
test('sort whitelist rejects arbitrary fields and prototype keys', () => {
  assert.deepEqual(buildFilters(db, scope, { sort: 'mostFollowed' }).order, ['followUpCount', 'desc']);
  for (const sort of ['phone', 'constructor', '__proto__']) assert.throws(() => buildFilters(db, scope, { sort }));
});
```

`phone` 测的是「合法字段名但不该被前端指定」，`constructor` 和 `__proto__` 测的是原型链。**测试名里的 "prototype keys" 就是给未来改代码的人看的警告**——别把 `hasOwnProperty` 删了。

## 16.5 day()：日期校验的三道关

```js
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期须为 YYYY-MM-DD');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  // UI dates represent calendar days in China, independent of server timezone.
  return new Date(value + 'T00:00:00+08:00');
}
```

三行代码，三道关。

### 第一关：类型 + 格式

```js
typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
```

- 类型：必须是字符串。传 `Date` 对象、数字时间戳都不接受。
- 格式：**严格 10 位**。`2026-1-1` 不通过（月份没补零），`2026-01-01T00:00` 不通过（多了时间部分）。

**为什么这么严？** 因为这是「UI 传上来的日历日」，格式是固定的。允许宽松格式，后面所有日期比较都要考虑多种写法，复杂度会爆炸。

### 第二关：往返校验

```js
date.toISOString().slice(0, 10) !== value
```

把字符串转成 `Date`，再转回 `'YYYY-MM-DD'`，比对是否和原文一致。

**这一步在防什么？** 防「解析时被悄悄归一化」。

比如 `2026-02-30`（2 月没有 30 号）：现代 V8 对 ISO 格式会直接判 `Invalid Date`，前一个条件 `Number.isFinite` 就拦住了。但**不是所有 JS 实现都这么严格**——某些环境会把非法日期「滚动」成 3 月 2 日，解析成功、值却是错的。

往返比对能挡住这种情况：解析出来是 3 月 2 日，转回去是 `'2026-03-02'`，和原文 `'2026-02-30'` 不一致，抛错。

**这是「不信任解析器」的防御性写法。** 同样的套路适用于任何「字符串 → 对象 → 字符串」的转换：解析完再序列化一次，比对原文，能发现所有被静默修改的情况。

### 第三关：显式时区

```js
return new Date(value + 'T00:00:00+08:00');
```

不写时区会怎样？`new Date('2026-01-01')` 在**现代规范里按 UTC 解析**，但在一些旧实现里按本地时区解析。云函数跑在 UTC，本地时区可能又是别的——同一个字符串在不同环境得到不同的时间戳。

加 `+08:00` 之后，含义唯一：**中国时间 2026 年 1 月 1 日零点**。换算成 UTC 是 2025-12-31 16:00。

这就是为什么数据库里 `nextFollowUpAt` 存的是「UTC 前一天 16:00」——`adminDashboard` 的注释专门解释过这件事：

```js
// cloudfunctions/adminDashboard/index.js:48
/** nextFollowUpAt 存的是中国零点（UTC 前一天 16:00），直接 slice ISO 会少一天 */
```

## 16.6 chinaToday()：为什么不用 Intl

```js
function chinaToday(now) {
  const timestamp = now === undefined ? Date.now() : now;
  const shifted = new Date(timestamp + 8 * 3600000);
  if (!Number.isFinite(shifted.getTime())) throw new Error('当前时间无效');
  return shifted.toISOString().slice(0, 10);
}
```

做法是「加 8 小时，再取 ISO 字符串的日期部分」。

### 为什么不用 Intl.DateTimeFormat

标准做法其实是这样：

```js
new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
// → '2026-10-25'
```

（用 `'en-CA'` 是因为加拿大英语的日期格式恰好是 `YYYY-MM-DD`，这是社区里常见的技巧。）

**为什么本项目没用？** 两个原因：

1. **依赖 ICU 数据**。Node 从 13 开始默认带 full-icu，但某些精简构建会裁掉时区数据，`Intl` 行为可能退化。云函数运行环境不一定能保证。
2. **`'en-CA'` 是隐式契约**。它靠「某个 locale 恰好是 ISO 格式」这个巧合工作，一旦 ICU 数据版本变化，格式可能变。

而「加 8 小时」是纯算术，不依赖任何本地化数据，行为在任何环境下都一样。

**代价**：只适用于固定时区（中国没有夏令时，所以没问题）。如果业务跨时区（比如有海外用户），就必须用 `Intl` 或存 UTC 时间戳再按用户时区渲染。

### 为什么把 now 做成参数

```js
const timestamp = now === undefined ? Date.now() : now;
```

这是**为可测试性留的缝**。测试里可以传一个固定的时间戳，验证边界：

```js
// tests/due-filters.test.js:9-13
test('chinaToday ignores the server timezone', () => {
  // 2026-10-21T16:30:00Z 在中国是 2026-10-22 00:30
  assert.equal(chinaToday(Date.parse('2026-10-21T16:30:00Z')), '2026-10-22');
  assert.equal(chinaToday(Date.parse('2026-10-21T15:30:00Z')), '2026-10-21');
});
```

两条断言只差一小时，结果差一天——因为 `16:30Z` 对应北京时间 00:30（跨天了），`15:30Z` 对应 23:30（还在当天）。**这就是边界测试的价值：一个小时的差距，能证明时区偏移真的生效了。**

`Date.now()` 直接写在函数里的话，这个断言永远写不出来——因为「现在」在变。

**「时间、随机数、网络」是三大不可测因素，都该做成参数。** 这是本项目里最值得抄的一个设计习惯。

## 16.7 dueConditions()：为什么返回数组

```js
function dueConditions(db, due, today) {
  if (due === undefined || due === '') return [];
  if (typeof due !== 'string' || !DUE_OPTIONS.includes(due)) throw new Error('待跟进筛选无效');
  const start = day(today);
  const conditions = [];
  if (due === 'today') {
    conditions.push({ nextFollowUpAt: db.command.gte(start) });
    conditions.push({ nextFollowUpAt: db.command.lt(new Date(start.getTime() + DAY_MS)) });
  }
  // ...
  return conditions;
}
```

**返回数组而不是单个对象**，是因为「今天」这个条件需要**两个**对象：`>= 今天零点` 和 `< 明天零点`。

如果返回单个对象，写成：

```js
{ nextFollowUpAt: db.command.gte(start), nextFollowUpAt: db.command.lt(end) }
```

第二个 key 会覆盖第一个，最终只剩 `lt`——查出来的是「所有早于明天的」，包括上个月的。

**这是全项目最隐蔽的坑**，因为代码看起来完全合理，运行也不报错，只是结果错了。

### 那个 `nin` 条件在做什么

```js
conditions.push(db.command.or([
  { lastStatus: db.command.nin(TERMINAL_STATUSES) },
  { lastStatus: db.command.exists(false), status: db.command.nin(TERMINAL_STATUSES) }
]));
```

`TERMINAL_STATUSES = ['WON', 'LOST']`——已成交和已关闭。这两类线索**不需要再提醒跟进**。

所以条件翻译成人话是：

> 状态不是「已成交/已关闭」的，才需要提醒。

写成 `or` 的两个分支，还是为了兼容旧数据：

- 新数据有 `lastStatus` → 第一个分支命中；
- 旧数据只有 `status` → 第二个分支命中（`lastStatus` 不存在 且 `status` 不是终态）。

**这个「同一个业务概念，在新旧数据里字段不同」的模式，在这个项目里出现了 4 次**（`leadList` 的状态筛选、这里、`adminDashboard` 的 `effectiveStatus`、`followup-edit` 的默认状态）。它是「不迁移数据、只做兼容」这个策略的必然代价。

## 16.8 buildFilters()：核心不变量

```js
function buildFilters(db, scope, event, options = {}) {
  const conditions = [scope];
  // ... 各种 push
  return { query: conditions.length === 1 ? scope : db.command.and(conditions), order: SORTS[sortKey] };
}
```

### 不变量一：`conditions[0]` 永远是 `scope`

第一行就是 `const conditions = [scope]`，之后所有 `push` 都往后追加。

这意味着：**最终生成的查询条件里，权限范围一定在里面**。任何新增的筛选项都不可能「覆盖掉」权限。

如果换成另一种写法：

```js
// ❌ 危险：每个分支自己拼条件，容易漏掉 scope
let query = {};
if (event.status) query.status = event.status;
if (event.keyword) query = _.or([...]);
```

漏掉 `scope` 就是一个越权漏洞——用户能看到所有团队的数据。**用「数组第一项固定」这个结构来保证安全，比在每个分支里提醒自己「别忘了加权限」可靠得多。**

这是本章最值得带走的一条：**用数据结构表达不变量，而不是靠纪律。**

### 不变量二：返回 `{query, order}`，不执行查询

`buildFilters` 只负责「构造」，不负责「执行」。真正查库的是调用方：

```js
// cloudfunctions/leadList/index.js:87-95
const leadsRes = await db.collection('leads')
  .where(query)
  .orderBy(filters.order[0], filters.order[1])
  .orderBy('_id', 'asc')
  .skip(skip)
  .limit(pageSize)
  .get();
```

**为什么拆开？** 因为「构造条件」和「执行查询」是两个不同的关注点：

- 构造是纯逻辑，可以单元测试（4 个测试文件都在测这个）；
- 执行涉及 IO，测试要 mock 整个数据库。

混在一起的话，想验证「传 `status: 'NEW'` 生成的查询条件对不对」，就得连数据库一起 mock。拆开之后，直接断言返回值就行。

**这是「纯函数下沉」的通用手法**：把可测的逻辑抽到纯函数里，让 IO 层变薄。

### 不变量三：抛 Error，不返回 `{success: false}`

```js
if (...) throw new Error('排序选项无效');
```

而调用方统一接住：

```js
// cloudfunctions/leadList/index.js:80-84
let filters;
try { filters = buildFilters(db, query, event); }
catch (error) { return { success: false, message: error.message }; }
```

**为什么不直接在 `buildFilters` 里返回 `{success: false}`？** 因为那会污染它的返回类型——正常返回 `{query, order}`，出错返回 `{success, message}`，调用方每次都要判断两种形状。

抛异常让「正常路径」和「错误路径」在类型上分开，调用方用 `try/catch` 一次性处理。**代价**：要记得包 `try/catch`，漏了就是未捕获异常（云函数会返回 500）。

## 16.9 逐行：每个 push 的意图

| 行 | 条件 | 意图 | 易错点 |
| --- | --- | --- | --- |
| `59` | `[scope]` | 权限范围打底 | 见上 |
| `60-61` | 排序 key | 白名单校验 | 用 `hasOwnProperty` |
| `62-65` | `{ _id: leadId }` | 按 ID 精确查（详情页用） | 必须校验非空字符串 |
| `66-68` | keyword 类型 + 长度 | 防超长正则 | 80 字符上限 |
| `69-76` | 三字段正则 `or` | 模糊搜索 | 必须转义元字符 |
| `77` | `createdAt >= from` | 起始日期 | 用 `day()` 转中国零点 |
| `78` | `createdAt < to + 1天` | 结束日期（**含当天**） | 加一天才能包含 `to` 当天 |
| `79` | from > to | 区间合法性 | 字符串比较（见下） |
| `80-81` | `unfollowed` | 未跟进 | 要兼容字段不存在 |
| `82-84` | due 条件 | 待跟进 | 返回数组 |
| `85` | 组合 + 排序 | 收口 | 单条件不包 `and` |

### 第 78 行：为什么 `createdTo` 要加一天

用户选「创建日期到 2026-10-25」，他的意思是「**包含** 10 月 25 日一整天」。

但数据库里存的是精确时间戳。如果写成 `createdAt <= 2026-10-25 00:00`，那么 10 月 25 日早上 9 点创建的线索就被排除了。

正确做法是 `< 2026-10-26 00:00`：

```js
conditions.push({ createdAt: db.command.lt(new Date(day(event.createdTo).getTime() + 86400000)) });
```

**「日期区间查询」的标准写法是「左闭右开」**：`>= 起始日零点` 且 `< 结束日次日零点`。这样不管时间戳精度是秒还是毫秒，边界都不会漏。

### 第 79 行：为什么字符串能比大小

```js
if (event.createdFrom && event.createdTo && event.createdFrom > event.createdTo) throw new Error('开始日期不能晚于结束日期');
```

`'2026-10-01' > '2026-09-30'` —— 字符串比较是逐字符比 ASCII 码。

这在 `YYYY-MM-DD` 格式下**恰好等价于时间先后**：因为年、月、日都是定长且高位在前（大端序）。所以字典序 = 时间序。

**但这是个「格式红利」，不是通用规律。** 如果格式变成 `'2026-1-5'`（月份不补零），`'2026-1-5' > '2026-10-01'` 会得到 `true`（因为 `'1'` > `'1'` 后比 `'-'` vs `'0'`，`'-'`(45) < `'0'`(48)…实际上会出错）。

所以这段代码能工作，**前提是前面 `day()` 已经保证了 10 位补零格式**。两个函数是耦合的——如果哪天放宽了 `day()` 的格式校验，这行比较就会失效。

**这类「隐式依赖」是精读源码时最该注意的地方**：看起来独立的一行，其实依赖别处的保证。

## 16.10 如何新增一个筛选项

假设要加「只看有备注的线索」。完整流程是 5 步，漏一步就不工作：

**第 1 步：在 `buildFilters` 加条件**

```js
if (event.hasRemarks !== undefined && typeof event.hasRemarks !== 'boolean') throw new Error('备注筛选须为布尔值');
if (event.hasRemarks) conditions.push({ remarks: db.command.nin(['', null]) });
```

注意要写**类型校验**——不加的话传 `'false'`（字符串）会被当成真值。

**第 2 步：`leadList` 不用改**

`buildFilters` 拿到的是整个 `event`，新字段自动可见。这是「把 event 整体传进去」的好处。

**第 3 步：前端 data + 事件**

```js
// utils/lead-page.js 的 data
hasRemarks: false

// 事件
onHasRemarksChange(e) { this.setData({ hasRemarks: e.detail.value }); this.loadLeads(); }
```

**第 4 步：WXML**

```html
<switch checked="{{hasRemarks}}" bindchange="onHasRemarksChange" />
```

**第 5 步：参数透传 + 偏好白名单**

```js
// loadLeads 的 params
hasRemarks: this.data.hasRemarks

// lead-tools.js 的 cleanPreferences 白名单
hasRemarks: data.hasRemarks === true
```

第 5 步最容易漏：如果只加进 `params` 不加进 `cleanPreferences`，那么「记住筛选偏好」时这个开关不会被保存，下次打开就丢了。

**最后：写测试。**

```js
// tests/lead-filters.test.js
test('hasRemarks filter only keeps leads with non-empty remarks', () => {
  const { query } = buildFilters(fakeDb, { groupId: 3 }, { hasRemarks: true });
  assert.deepEqual(query.and[1], { remarks: { nin: ['', null] } });
});
```

**「加一个筛选项要改 5 个地方」是这个架构的固有成本。** 它不是设计缺陷，而是「分层清晰」的代价：每层各管一件事，加功能就得每层都动一下。

如果觉得太麻烦，可以考虑用「配置表驱动」——把筛选项定义成数组，各层遍历生成。但那会牺牲可读性（读代码时要先读配置表）。**这个项目选了可读性，是对的**：筛选项数量少，改动频率低。

## 16.11 复杂度与性能

`buildFilters` 本身是 O(k)，k 是筛选项个数（最多 6 个）。真正的性能问题不在它，在它生成的查询上：

| 筛选项 | 能否用索引 | 说明 |
| --- | --- | --- |
| `groupId` | ✅ | 建议建 `groupId+role` 复合索引 |
| `createdAt` 区间 | ✅ | 建索引后范围扫描 |
| `_id` | ✅ | 主键天然有索引 |
| `assignedSalesIds` | ⚠️ 部分 | 数组字段，`in` 查询可用索引 |
| `status` / `lastStatus` | ✅ | 建议建索引 |
| `keyword`（正则） | ❌ | **无法用索引，全表扫描** |
| `remarks`（正则） | ❌ | 且该字段没建索引 |

所以：

- **不输关键词**：查询走索引，几万条也是毫秒级；
- **输了关键词**：三个字段各扫一遍，数据量上万后明显变慢。

**这就是 issue #30 指出的性能边界。** 解法不是「优化 `buildFilters`」，而是换检索方案（独立搜索集合、或者只对名称/电话做前缀匹配）。

**一条经验**：看到 `RegExp` 出现在查询条件里，就要意识到「这个接口有数据量上限」。它不是 bug，是设计约束——但必须在文档里写清楚。

## 16.12 练习

1. **验证原型链坑**：把 `hasOwnProperty` 那行改成 `if (!SORTS[sortKey])`，然后调 `buildFilters(db, {}, { sort: 'constructor' })`，看会发生什么（提示：`order` 会变成函数）。
2. **复现时间区间覆盖**：把 `dueConditions` 里 `today` 分支的两个 `push` 合并成一个对象，跑 `npm test`，找出哪几个用例挂了，读懂它们的断言。
3. **加一个筛选项**：按 16.10 的 5 步，加「只看已逾期」。注意第 5 步（偏好白名单）别漏。
4. **测时区**：给 `chinaToday` 写一个测试，覆盖「北京时间 00:30」和「北京时间 23:30」两个边界，确认都返回当天日期。
5. **算索引收益**：假设 5 万条线索，`groupId` 索引把扫描量从 5 万降到 500 条。估算一下查询耗时差多少倍（提示：索引是 B 树，O(log n) vs O(n)）。

---

上一篇：[15 一次请求的完整旅程](15-一次请求的完整旅程.md) · 下一篇：[17 测试精读与故障演练](17-测试精读与故障演练.md)
