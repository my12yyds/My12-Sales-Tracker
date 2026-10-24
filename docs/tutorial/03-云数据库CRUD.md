# 03 云数据库 CRUD

> 本章涉及的 API：`db.collection`、`.add()`、`.doc().get()`、`.doc().update()`、`.doc().remove()`、`.where().get()`、`.field()`、`.count()`、`db.createCollection()`

云开发的数据库是文档型（类似 MongoDB），但没有 schema 约束——字段随便加，代价是校验全靠代码。

本章把增删改查四件套讲透，重点在**几个返回值你一定会用错**。

## 3.1 数据模型

三个概念，对应关系：

| 关系型 | 云开发 |
| --- | --- |
| 表 table | 集合 collection |
| 行 row | 文档 document（就是一个 JSON 对象） |
| 列 column | 字段 field |

本项目的两个核心集合：

```
users                            leads
├── _id        自动生成           ├── _id
├── openid     微信用户标识        ├── groupId      团队编号
├── role       0/1/2             ├── phone        电话（可为空串）
├── groupId    团队编号           ├── customerName 客户/事项名称
├── name       姓名               ├── assignedSalesIds  协作成员 ID 数组
├── phone      手机号             ├── status / lastStatus
└── createdAt  创建时间           ├── followUpCount
                                 └── nextFollowUpAt
```

`_id` 由数据库自动生成（一串随机字符），**不需要你指定，也不能改**。后续所有「精确操作单条」的 API 都要用它。

## 3.2 增：add

```js
// cloudfunctions/leadCreate/index.js:142
const addRes = await db.collection('leads').add({ data: leadData });
```

参数必须包一层 `{ data: ... }`，这是云开发所有写操作的统一约定（`update`、`remove` 也是）。

返回值：

```js
{ _id: "a1b2c3d4..." }   // 新文档的 ID
```

**只返回 `_id`，不返回你写进去的内容。** 本项目需要把新线索返回给前端，所以自己拼：

```js
// cloudfunctions/leadCreate/index.js:144-150
return {
  success: true,
  data: {
    _id: addRes._id,
    ...leadData        // 把写进去的对象展开回来
  }
};
```

### 一个隐藏字段：openid

如果是**前端直连**数据库调用 `add`，云开发会自动往文档里塞一个 `_openid` 字段（记录创建者）。但**云函数里 add 不会自动加**——因为云函数是以管理员身份运行的，没有「当前用户」这个概念。

本项目在云函数里创建线索时，是手动写 `createdByAnchorId: userId` 来记录创建者的。这是正确做法：需要「谁创建的」这种信息时，显式存，别指望 `_openid`。

## 3.3 查：两种入口，别混用

### 按 _id 查单条：doc().get()

```js
// cloudfunctions/adminUserUpdate/index.js:54
const userDoc = await db.collection("users").doc(targetUserId).get();
if (!userDoc.data) return { success: false, message: "目标用户不存在" };
```

**注意返回值形状：`res.data` 是单个对象，不是数组。** 这点和 `where().get()` 完全不同，是最常见的混淆点。

`doc().get()` 查不到时不会抛错，`res.data` 为 `null`。所以必须判空，否则后面 `userDoc.data.role` 直接 `TypeError`。

### 按条件查多条：where().get()

```js
// cloudfunctions/authLogin/index.js:26
const existed = await db.collection("users").where({ openid }).limit(1).get();
if (existed.data && existed.data.length > 0) {
  const u = existed.data[0];
```

**`res.data` 是数组**，即使只可能有一条也要 `[0]`。

两个配套动作：

**`.limit(1)` 不是可选的。** 按 `openid` 查用户理论上只有一条，但不加 `limit` 会让数据库扫更多记录再返回（云函数端默认上限是 100 条，见[第 04 章](04-查询指令与分页上限.md)）。明确「我只要一条」就写 `limit(1)`，既省资源也表达意图。

**`.field()` 裁剪字段。** 默认返回整条文档，包含所有字段。如果只需要两个字段，就明确说：

```js
// cloudfunctions/groupMembers/index.js:39-43
const salesRes = await db.collection('users')
  .where({ role: 2, groupId })
  .field({ _id: true, name: true })
  .limit(200)
  .get();
```

`field` 的写法是 `{ 字段名: true }` 白名单（也可以用 `false` 做黑名单，但不能混用）。

这个函数是给「协作成员」下拉框用的，只需要 ID 和姓名。用 `field` 有两个好处：

1. **减少传输量**——不把手机号、微信号传到前端；
2. **减少泄露面**——前端能拿到的东西，用户就能看到。哪怕界面不显示，抓包也能看到。

这是本项目里一个值得记住的细节：**返回字段的范围，是安全边界的一部分。**

## 3.4 改：doc().update()

```js
// cloudfunctions/adminUserUpdate/index.js:73-79
const update = { updatedAt: new Date() };
if (newRole === 0) update.groupId = 0;
if (name !== undefined) update.name = name;
if (role !== undefined) update.role = role;
if (groupId !== undefined) update.groupId = groupId;

await db.collection("users").doc(targetUserId).update({ data: update });
```

### 要点一：局部更新，不是替换

`update` 只改你传的字段，其他字段保持原样。这点和某些 ORM 的 `save()` 不同。

所以上面这段代码用 `if (xxx !== undefined)` 逐个判断——**只把用户真正想改的字段放进 `update` 对象**。如果无脑写成 `{ name, role, groupId }`，那么用户只想改名字时，`role` 和 `groupId` 会被 `undefined` 覆盖（实际上云开发会忽略 `undefined` 字段，但依赖这个行为很危险，显式判断更可靠）。

### 要点二：返回值你可能没看

```js
{ stats: { updated: 1 } }
```

`updated: 0` 表示**没有匹配到文档**——不是报错，是静默失败。本项目改完之后重新 `get()` 一次来确认：

```js
// cloudfunctions/adminUserUpdate/index.js:81-82
const updated = await db.collection("users").doc(targetUserId).get();
const u = updated.data;
```

多一次查询有性能成本，但能保证返回给前端的是**数据库里的真实状态**，而不是「我以为我改成了什么」。这个取舍在本项目里是值得的：用户管理是低频操作，正确性优先。

### 要点三：原子操作符

想让某个数值字段「加一」而不是「设成某个值」，用 `db.command.inc`：

```js
db.collection('leads').doc(id).update({ data: { followUpCount: db.command.inc(1) } });
```

如果写成「先 get 出来 +1 再 update」，两个请求同时进来就会丢更新（A 读到 5，B 也读到 5，都写 6，实际应该 7）。`inc` 在数据库层面完成加法，不会有这个问题。

本项目没有用 `inc`（跟进次数是创建时一次性算好的），但这是并发场景的必备知识。

## 3.5 删：doc().remove()

```js
// cloudfunctions/leadDelete/index.js:68
await db.collection('leads').doc(leadId).remove();
```

返回值同样是 `{ stats: { removed: 1 } }`，`removed: 0` 表示没删到东西。

**删除不会级联。** 删掉一条线索，它名下的跟进记录（`followUps` 集合里 `leadId` 指向它的那些）**不会自动删除**，会变成孤儿数据。本项目手动做了级联：

```js
// cloudfunctions/leadDelete/index.js:53-65
let removed = 0;
for (let round = 0; round < 100; round++) {
  const batch = await db.collection('followUps').where({ leadId }).limit(100).get();
  if (!batch.data || batch.data.length === 0) break;
  await Promise.all(batch.data.map(followUp =>
    db.collection('followUps').doc(followUp._id).remove()
  ));
  removed += batch.data.length;
  if (batch.data.length < 100) break;
}
```

这段代码有三个值得学的点：

1. **为什么循环 100 次**：一次 `get()` 最多返回 100 条（`limit(100)`），删完再查下一批。这个「查一批删一批」的模式是云开发里批量删除的标准写法。
2. **为什么上限是 100 轮**：防止死循环。但代价是超过 1 万条跟进记录时删不干净——这是个已知缺陷，见[第 12 章](12-踩坑清单与调试.md)。
3. **为什么用 `Promise.all`**：100 个删除并行发出，比串行快 100 倍。但并发太高容易撞云开发的频率限制，实际项目里建议降到 20~30。

## 3.6 count：只要数量

```js
db.collection('leads').where({ groupId: 3 }).count()
// → { total: 42 }
```

`count` 不返回文档内容，只返回条数。**它不受单次查询条数上限影响**——因为根本不返回记录。

分页时用它算总页数，比 `get()` 全量回来数一遍高效得多。本项目在 `leadList` 里就是 `get()` 拿当页数据 + `count()` 拿总数，两条查询并行发出。

## 3.7 createCollection：集合不存在时

云开发的集合**不会自动创建**。第一次访问不存在的集合会抛错，错误码 `-502005`（或 `DATABASE_COLLECTION_NOT_EXIST`）。

本项目的处理方式：

```js
// cloudfunctions/authLogin/index.js:23-36
let existed;
try {
  existed = await db.collection("users").where({ openid }).limit(1).get();
} catch (e) {
  if (e && (e.errCode === -502005 || e.code === "DATABASE_COLLECTION_NOT_EXIST")) {
    await db.createCollection("users");
    existed = { data: [] };
  } else {
    console.error("查询 users 集合失败:", e);
    return { success: false, message: "用户初始化失败：" + (e.message || e.errMsg || "") };
  }
}
```

`userRegister` 里也有同样一段（`index.js:40-48`）。

**这是「首次部署零配置」的写法**，好处是管理员第一次打开小程序就能用，不用先进控制台手动建集合。代价是错误处理变长了。

注意 `catch` 里必须区分错误类型：只有「集合不存在」才建集合，其他错误（网络、权限、语法）必须原样抛出，否则会把真实问题吞掉，变成「查不出数据也不报错」的诡异状态。

## 3.8 权限规则：为什么云函数能改别人的数据

云开发控制台可以给每个集合设置权限，常见四种：

| 规则 | 含义 |
| --- | --- |
| 所有用户可读，仅创建者可读写 | 默认，最宽松 |
| 仅创建者可读写 | 用户只能碰自己创建的记录 |
| 仅管理端可读写 | 前端完全不能直接访问 |
| 所有用户不可读写 | 前端完全禁止 |

**关键事实：云函数以管理员身份运行，不受这些规则约束。**

所以：

- 前端 `wx.cloud.database()` 直连 → 受规则约束；
- 云函数 `cloud.database()` → **绕过规则，能读写任意记录**。

这解释了两件事：

1. 为什么本项目把写操作全部放在云函数里——如果前端直连，用户能改别人团队的数据（只要权限规则没配严）；
2. 为什么云函数里的权限校验**必须自己写全**——数据库不会帮你拦。`leadDelete` 里那段「负责人只能删本团队线索」的判断，就是唯一的防线：

```js
// cloudfunctions/leadDelete/index.js:47-49
if (role === 1 && lead.groupId !== groupId) {
  return { success: false, message: '只能删除本团队线索' };
}
```

漏掉这段，任何负责人就能删掉任何团队的线索，数据库一声不吭。

## 3.9 练习

1. **区分两种 get 的返回值**：在 `authLogin` 里加 `console.log(existed.data)`，确认它是数组；在 `adminUserUpdate` 里加 `console.log(userDoc.data)`，确认它是对象。
2. **验证 field 的效果**：把 `groupMembers` 的 `.field({ _id: true, name: true })` 注释掉，在真机/模拟器里调用一次，看返回里多了什么字段。改回来。
3. **观察 update 的静默失败**：用一个不存在的 `userId` 调 `adminUserUpdate`，看 `stats.updated` 的值，确认它不报错。
4. **补一个级联删除的边界**：给 `leadDelete` 写一个测试，构造 150 条跟进记录，确认循环能删干净。

---

上一篇：[02 云开发接入与调用云函数](02-云开发接入与调用云函数.md) · 下一篇：[04 查询指令与分页上限](04-查询指令与分页上限.md)
