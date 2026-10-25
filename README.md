# 通用客户与事项跟进系统（微信云开发）· 教学版

[![Regression checks](https://github.com/my12yyds/My12-Sales-Tracker/actions/workflows/checks.yml/badge.svg)](https://github.com/my12yyds/My12-Sales-Tracker/actions/workflows/checks.yml)
[![CodeQL](https://github.com/my12yyds/My12-Sales-Tracker/actions/workflows/codeql.yml/badge.svg)](https://github.com/my12yyds/My12-Sales-Tracker/actions/workflows/codeql.yml)

这是一个**能直接用**的客户与事项跟进系统，也是一份**按 API 组织的微信小程序教程**。

项目里每个 `wx.*` 和 `db.*` 调用都能在 [docs/tutorial](docs/tutorial/00-导读与课程地图.md) 里找到对应讲解：它是干什么的、参数怎么传、返回值什么形状、什么情况下会坑你。所有例子都标注了文件与行号，可以边读边跳过去看。

适用于客户服务、商务合作、项目事项和团队协作。支持单人负责人及多团队使用，不再限定主播、销售或固定四组。仓库名与部分内部字段保留，以兼容已有用户和数据库。

**项目制作人：** [my12yyds](https://github.com/my12yyds)、[Lyon-heng](https://github.com/Lyon-heng)。[制作人名单](AUTHORS.md)

当前源码版本：**v0.2.0 通用版（预发布）**。[完整版本下载](https://github.com/my12yyds/My12-Sales-Tracker/releases/tag/v0.2.0) · [更新日志](CHANGELOG.md)。v0.1.0 保留为原有场景的历史源码包。

## 教学版：跟着源码学小程序 API

[**→ 从导读页开始读**](docs/tutorial/00-导读与课程地图.md)

17 章，按「地基 → 交互 → 界面与权限 → 收口与延伸 → 深度精读」五段递进，每章结尾有动手练习：

| 篇 | 章节 | 覆盖的 API |
| --- | --- | --- |
| 地基 | [01 项目结构与生命周期](docs/tutorial/01-项目结构与生命周期.md) | `App()`、`Page()`、`setData`、`onPullDownRefresh`、`onReachBottom` |
| | [02 云开发接入与调用云函数](docs/tutorial/02-云开发接入与调用云函数.md) | `wx.cloud.init`、`wx.cloud.callFunction`、`cloud.getWXContext` |
| | [03 云数据库 CRUD](docs/tutorial/03-云数据库CRUD.md) | `db.collection`、`.add/.get/.update/.remove`、`.field` |
| | [04 查询指令与分页上限](docs/tutorial/04-查询指令与分页上限.md) | `db.command` 全套、`db.RegExp`、分页与单次上限 |
| 交互 | [05 交互反馈 API](docs/tutorial/05-交互反馈API.md) | `showToast`、`showLoading`、`showModal`、`showActionSheet` |
| | [06 页面路由与参数传递](docs/tutorial/06-页面路由与参数传递.md) | `navigateTo`、`redirectTo`、`reLaunch`、`navigateBack` |
| | [07 本地存储与登录缓存](docs/tutorial/07-本地存储与登录缓存.md) | `setStorageSync`、`getStorageSync`、缓存清洗 |
| | [08 设备能力与文件导出](docs/tutorial/08-设备能力与文件导出.md) | `makePhoneCall`、`setClipboardData`、`getFileSystemManager`、`shareFileMessage` |
| 界面与权限 | [09 WXML 数据绑定与事件](docs/tutorial/09-WXML数据绑定与事件.md) | `wx:if`、`wx:for`、`wx:key`、`bindtap`、`data-*` |
| | [10 表单组件与选择器](docs/tutorial/10-表单组件与选择器.md) | `picker`、`input`、`textarea`、`switch`、`checkbox` |
| | [11 权限模型与鉴权链路](docs/tutorial/11-权限模型与鉴权链路.md) | `getWXContext` 鉴权链、对象级权限、沙箱测试 |
| | [12 踩坑清单与调试](docs/tutorial/12-踩坑清单与调试.md) | 10 个真实坑 + 调试手段 + 自查清单 |
| 收口与延伸 | [13 速查手册与自测题](docs/tutorial/13-速查手册与自测题.md) | 一页纸速查表 + 20 道自测题（答案折叠） |
| | [14 本项目没用到但值得知道的能力](docs/tutorial/14-扩展能力清单.md) | 云存储、聚合统计、定时触发器、事务、自定义组件、分包、WXS |
| 深度精读 | [15 一次请求的完整旅程](docs/tutorial/15-一次请求的完整旅程.md) | 跨 6 个文件追踪一次点击，含时序图与失败路径 |
| | [16 源码精读：buildFilters 的 87 行](docs/tutorial/16-源码精读-buildFilters.md) | 三个不变量、原型链坑、日期往返校验、时区 |
| | [17 测试精读与故障演练](docs/tutorial/17-测试精读与故障演练.md) | `vm` 沙箱测试替身 + 9 个真实症状定位练习 |

导读页里还有一张完整的 [API 索引表](docs/tutorial/00-导读与课程地图.md#api-索引表)，可以直接按 API 反查它在哪个文件被用到。

**只学不跑也可以**：教程里所有代码片段都标注了位置，`npm test` 不连真实云环境也能跑（用 `vm` 沙箱伪造了 SDK）。

**附一个可点的 API 实验室**：`pages/api-lab/index` 把教程里的 API 做成按钮，点一下就能看到真实返回值。它不挂在导航里，用开发者工具的「添加编译模式」打开（步骤见[导读页](docs/tutorial/00-导读与课程地图.md)）。


## 主要功能

- 管理员、负责人、成员三种通用角色；团队使用正整数编号，不限制四组。
- 客户/事项名称、选填联系电话、备注、协作分配与跟进记录。
- 单人负责人可直接使用；没有其他成员时新记录自动分配给自己。
- 名称/电话/备注搜索、四种排序、日期范围、未跟进筛选与分页加载。
- 精确详情、拨号、复制电话、已加载结果 CSV 导出及本机筛选偏好。
- 管理员动态团队看板、用户管理和团队设置。
- 通用流程：待处理、沟通中、方案确认、已完成、已关闭。

权限在云函数中校验；成员仍仅能查看当前团队中分配给自己的记录。团队不等于独立企业租户。

## 开始使用

1. 克隆 main 或下载对应提交的源码，用微信开发者工具打开根目录。
2. 公共配置保持 YOUR_APPID、YOUR_CLOUD_ENV_ID，在自己的本机配置实际环境；不要提交凭据。
3. 安装并部署 cloudfunctions 下各函数的依赖及完整目录，按云平台提示配置数据库集合、权限和索引。
4. 首次登录进入注册，普通账号默认未分配团队。由可信管理员设置角色和团队；普通用户不能自选管理员。
5. 单人使用：将自己的业务账号设为负责人、团队1；多团队使用：为各负责人和成员设置不同的正整数编号。
6. 先用虚构数据完成编译、云端和真机验收，再考虑生产发布。

## 本地检查

需要 Node.js 20 或更新版本，根目录没有运行时依赖：

```sh
npm test
npm run check:syntax
npm run check:public
npm run check:docs      # 教程的行号引用、站内链接、章节导航链
npm run check           # 上面四项一次跑完
```

测试模拟云 SDK，不访问真实数据库。通过测试不代表已完成微信云端、编译或真机验收。

当前 75 项测试覆盖云函数的权限校验、查询条件构造、查重、分页与日期边界。教程里每章的「练习」都可以用这套测试验证有没有改坏东西。

`check:docs` 会校验教程里 100 多处 `文件:行号` 引用：文件是否存在、行号是否越界、指向的行是不是空行或孤立的 `}`。代码改动导致行号漂移时 CI 会失败，避免文档悄悄对不上代码。

## 文档与协作

- **教学教程**：[导读与课程地图](docs/tutorial/00-导读与课程地图.md)（17 章，按 API 与代码精读组织）
- [通用化设置、兼容协议及升级说明](docs/GENERAL_PURPOSE.md)
- [搜索、导出等工作台功能](docs/LEAD_WORKSPACE.md)
- [公开配置与部署边界](docs/PUBLIC_CONFIGURATION.md)
- [维护说明](docs/MAINTENANCE.md)、[更新日志](CHANGELOG.md)
- [参与贡献](CONTRIBUTING.md)、[获取帮助](SUPPORT.md)、[安全报告](SECURITY.md)
- [反馈问题](https://github.com/my12yyds/My12-Sales-Tracker/issues/new/choose)、[GitHub 维护功能](docs/GITHUB_MAINTENANCE.md)

旧版安装/设计文档保留作历史参考；与当前通用版冲突时以通用化说明和当前代码为准。

## 边界与许可证

没有连接真实生产环境。看板使用有上限的分页读取；并发写入一致性、大数据量聚合和完整权限审计仍有后续工作。当前流程名称可在展示层继续调整，内部兼容代码不自动迁移。

许可证以 [LICENSE](LICENSE) 中的 AGPL-3.0 为准。
