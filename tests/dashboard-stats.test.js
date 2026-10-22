const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const DAY_MS = 86400000;

/** 中国日历日零点，与云函数内部算法一致 */
function chinaStartOfToday() {
  const dayText = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return new Date(dayText + 'T00:00:00+08:00');
}

function load(data, user) {
  const db = {
    command: {},
    collection(name) {
      const all = (data[name] || []).map(row => ({ ...row, openid: 'openid-' + row._id }));
      let rows = all;
      let skip = 0;
      let limit = all.length;
      const query = {
        where(condition) {
          // 只实现 openid 条件，看板其余查询不带 where
          if (condition && condition.openid) rows = all.filter(row => row.openid === condition.openid);
          return this;
        },
        field() { return this; },
        orderBy() { return this; },
        skip(value) { skip = value; return this; },
        limit(value) { limit = value; return this; },
        async get() { return { data: rows.slice(skip, skip + limit) }; }
      };
      return query;
    }
  };
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'openid-' + user._id }) };
  const name = 'adminDashboard';
  const localRequire = createRequire(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'));
  const sandbox = { exports: {}, require: id => (id === 'wx-server-sdk' ? cloud : localRequire(id)), console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox);
  return sandbox.exports.main;
}

const today = chinaStartOfToday();
const yesterday = new Date(today.getTime() - DAY_MS);

const users = [
  { _id: 'admin', name: '老板', role: 0, groupId: 0 },
  { _id: 'anchor', name: '主播A', role: 1, groupId: 1 },
  { _id: 's1', name: '销售甲', role: 2, groupId: 1 },
  { _id: 's2', name: '销售乙', role: 2, groupId: 1 }
];

const leads = [
  { _id: 'L1', groupId: 1, phone: '13800000001', lastStatus: 'NEW', assignedSalesIds: ['s1'], followUpCount: 1, createdAt: new Date(), nextFollowUpAt: today },
  { _id: 'L2', groupId: 1, phone: '13800000002', lastStatus: 'WON', assignedSalesIds: ['s1'], followUpCount: 2, createdAt: new Date(), nextFollowUpAt: yesterday },
  { _id: 'L3', groupId: 1, phone: '13800000003', lastStatus: 'QUOTED', assignedSalesIds: ['s2'], followUpCount: 0, createdAt: new Date(), nextFollowUpAt: yesterday },
  { _id: 'L4', groupId: 2, phone: '13800000004', status: 'LOST', assignedSalesIds: ['s2'], followUpCount: 0, createdAt: new Date() }
];

const followUps = [
  { leadId: 'L1', salesId: 's1', status: 'NEW' },
  { leadId: 'L2', salesId: 's1', status: 'CONTACTED' },
  { leadId: 'L2', salesId: 's1', status: 'WON' }
];

test('dashboard totals, conversion and reminders are computed from all records', async () => {
  const main = load({ users, leads, followUps }, users[0]);
  const result = await main({});
  assert.equal(result.success, true);
  const { summary, groupStats, salesRanking, partial } = result.data;

  assert.equal(summary.totalLeads, 4);
  assert.equal(summary.followedLeads, 2);
  assert.equal(summary.followUpRate, 50);
  assert.equal(summary.statusStats.WON, 1);
  assert.equal(summary.statusStats.LOST, 1);
  assert.equal(summary.conversionRate, 25);
  assert.equal(summary.totalFollowUps, 3);
  assert.equal(summary.avgFollowUpCount, 0.75);
  assert.equal(summary.dueToday, 1);
  // 成交线索即使有历史计划也不算逾期
  assert.equal(summary.overdue, 1);
  assert.equal(partial, false);

  // 第 2 组只有一条流失线索，没有待跟进
  assert.equal(groupStats[1].totalLeads, 1);
  assert.equal(groupStats[1].anchors, 0);
  assert.equal(groupStats[1].overdue, 0);
  assert.equal(groupStats[0].sales, 2);
});

test('sales ranking sorts by closed deals and follows the same rules', async () => {
  const main = load({ users, leads, followUps }, users[0]);
  const { salesRanking } = (await main({})).data;
  assert.equal(salesRanking.length, 2);
  assert.equal(salesRanking[0]._id, 's1');
  assert.equal(salesRanking[0].wonCount, 1);
  assert.equal(salesRanking[0].followUpCount, 3);
  assert.equal(salesRanking[0].assignedCount, 2);
  assert.equal(salesRanking[0].conversionRate, 50);
  assert.equal(salesRanking[1]._id, 's2');
  assert.equal(salesRanking[1].overdueCount, 1);
  assert.equal(salesRanking[1].conversionRate, 0);
});

test('non-admins cannot read the dashboard', async () => {
  const main = load({ users, leads, followUps }, users[2]);
  const result = await main({});
  assert.equal(result.success, false);
  assert.match(result.message, /管理员/);
});
