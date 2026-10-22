const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

/** 极简 where 匹配器，只覆盖 leadCreateBatch 用到的条件 */
function matches(row, condition) {
  return Object.keys(condition).every(key => {
    const expected = condition[key];
    if (expected && typeof expected === 'object' && 'in' in expected) {
      const actual = row[key];
      return Array.isArray(actual)
        ? actual.some(value => expected.in.includes(value))
        : expected.in.includes(actual);
    }
    return row[key] === expected;
  });
}

function load({ users, leads }, openid = 'openid-anchor') {
  const store = {
    users: users.map((u, index) => ({ openid: 'openid-' + (u._id || index), ...u })),
    leads: leads.slice()
  };
  const db = {
    command: { in: values => ({ in: values }) },
    collection(name) {
      const rows = () => store[name] || [];
      let matched = rows();
      let skip = 0;
      let limit = 1000;
      return {
        where(condition) { matched = rows().filter(row => matches(row, condition)); return this; },
        field() { return this; },
        orderBy() { return this; },
        skip(value) { skip = value; return this; },
        limit(value) { limit = value; return this; },
        async get() { return { data: matched.slice(skip, skip + limit) }; },
        async add(value) {
          const row = { _id: 'lead-' + (store.leads.length + 1), ...value.data };
          store.leads.push(row);
          return { _id: row._id };
        }
      };
    }
  };
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: openid }) };
  const name = 'leadCreateBatch';
  const localRequire = createRequire(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'));
  const sandbox = { exports: {}, require: id => (id === 'wx-server-sdk' ? cloud : localRequire(id)), console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox);
  return { main: sandbox.exports.main, store };
}

const users = [
  { _id: 'anchor', role: 1, groupId: 1, name: '主播' },
  { _id: 's1', role: 2, groupId: 1, name: '销售甲' },
  { _id: 's2', role: 2, groupId: 1, name: '销售乙' },
  { _id: 'other', role: 2, groupId: 2, name: '外组销售' }
];

test('batch skips existing phones, reports invalid input and creates the rest', async () => {
  const { main, store } = load({
    users,
    leads: [{ _id: 'old', groupId: 1, phone: '13800000001', assignedSalesIds: ['s1'], followUpCount: 1 }]
  });
  const result = await main({ phones: '13800000001\n138-0000-0002\n13800000003\nbad-number' });
  assert.equal(result.success, true);
  const data = result.data;
  assert.equal(data.createdCount, 2);
  assert.equal(data.duplicateCount, 1);
  assert.equal(data.invalidCount, 1);
  assert.deepEqual(data.duplicates, ['13800000001']);
  assert.ok(data.invalid.includes('bad-number'));
  assert.equal(store.leads.length, 3);
  const created = store.leads.filter(lead => lead._id.startsWith('lead-'));
  assert.equal(created.length, 2);
  assert.ok(created.every(lead => lead.groupId === 1 && lead.status === 'NEW' && lead.lastStatus === 'NEW'));
  assert.ok(created.every(lead => lead.createdByAnchorId === 'anchor'));
});

test('batch distributes new leads across the least loaded sales', async () => {
  const { main, store } = load({
    users,
    // s1 已有两条，s2 零条 → 新线索应优先给 s2
    leads: [
      { _id: 'a', groupId: 1, phone: '13900000001', assignedSalesIds: ['s1'], followUpCount: 0 },
      { _id: 'b', groupId: 1, phone: '13900000002', assignedSalesIds: ['s1'], followUpCount: 0 }
    ]
  });
  const result = await main({ phones: ['13800000011', '13800000012'] });
  assert.equal(result.success, true);
  const created = store.leads.filter(lead => lead._id.startsWith('lead-'));
  assert.deepEqual(created.map(lead => lead.assignedSalesIds[0]), ['s2', 's2']);
  assert.equal(created[0].batchId, created[1].batchId);
});

test('explicit sales assignment is validated against the group', async () => {
  const { main, store } = load({ users, leads: [] });
  const ok = await main({ phones: ['13800000021'], assignedSalesIds: ['s2'] });
  assert.equal(ok.success, true);
  assert.deepEqual(store.leads[0].assignedSalesIds, ['s2']);

  const crossGroup = await main({ phones: ['13800000022'], assignedSalesIds: ['other'] });
  assert.equal(crossGroup.success, false);
  assert.match(crossGroup.message, /不在本组/);
});

test('batch rejects empty input, oversized batches and non-anchor users', async () => {
  const { main } = load({ users, leads: [] });
  assert.equal((await main({ phones: '   ' })).success, false);
  assert.equal((await main({ phones: ['abc'] })).success, false);
  const tooMany = Array.from({ length: 101 }, (_, i) => '138' + String(10000000 + i));
  const oversize = await main({ phones: tooMany });
  assert.equal(oversize.success, false);
  assert.match(oversize.message, /最多/);

  // 销售身份调用批量录入应被拒绝
  const asSales = load({ users, leads: [] }, 'openid-s1');
  const denied = await asSales.main({ phones: ['13800000041'] });
  assert.equal(denied.success, false);
  assert.match(denied.message, /主播/);
  assert.equal(asSales.store.leads.length, 0);
});

test('batch create works for teams above four and rejects unassigned groups', async () => {
  const { main, store } = load({
    users: [
      { _id: 'manager', role: 1, groupId: 42, name: '负责人42' },
      { _id: 's42', role: 2, groupId: 42, name: '销售42' }
    ],
    leads: []
  }, 'openid-manager');
  const result = await main({ phones: ['13800000051', '13800000052'] });
  assert.equal(result.success, true);
  assert.equal(result.data.createdCount, 2);
  assert.ok(store.leads.every(lead => lead.groupId === 42 && lead.status === 'NEW'));

  const unassigned = load({ users: [{ _id: 'manager', role: 1, groupId: 0, name: '未分组' }], leads: [] }, 'openid-manager');
  const denied = await unassigned.main({ phones: ['13800000061'] });
  assert.equal(denied.success, false);
  assert.match(denied.message, /分配小组/);
  assert.equal(unassigned.store.leads.length, 0);
});

test('a batch that is entirely duplicates creates nothing but stays successful', async () => {
  const { main, store } = load({
    users,
    leads: [{ _id: 'old', groupId: 1, phone: '13800000031', assignedSalesIds: ['s1'], followUpCount: 0 }]
  });
  const result = await main({ phones: '13800000031' });
  assert.equal(result.success, true);
  assert.equal(result.data.createdCount, 0);
  assert.equal(result.data.duplicateCount, 1);
  assert.equal(store.leads.length, 1);
});
