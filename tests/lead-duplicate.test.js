const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// 隔离的云函数测试壳：不安装 SDK，也不连接真实数据库
function load(existingLeads, user) {
  const added = [];
  const db = {
    command: { in: values => ({ in: values }) },
    collection(name) {
      let condition = null;
      return {
        where(value) { condition = value; return this; },
        limit() { return this; },
        orderBy() { return this; },
        skip() { return this; },
        field() { return this; },
        async get() {
          if (name === 'users') return { data: [user] };
          if (name === 'leads') {
            // 只按 phone 精确过滤，够覆盖本轮的查重逻辑
            const rows = condition && condition.phone
              ? existingLeads.filter(lead => lead.phone === condition.phone)
              : existingLeads;
            return { data: rows };
          }
          return { data: [] };
        },
        async count() { return { total: existingLeads.length }; },
        async add(value) { added.push(value); return { _id: 'new-lead' }; }
      };
    }
  };
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'anchor-openid' }) };
  const name = 'leadCreate';
  const localRequire = createRequire(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'));
  const sandbox = {
    exports: {},
    require: id => (id === 'wx-server-sdk' ? cloud : localRequire(id)),
    console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox);
  return { main: sandbox.exports.main, added };
}

const anchor = { _id: 'anchor', role: 1, groupId: 2 };

test('same-group duplicate phone is reported instead of silently created', async () => {
  const { main, added } = load([{ _id: 'old', phone: '13800000001' }], anchor);
  const result = await main({ phone: ' 13800000001 ', assignedSalesIds: ['sales'] });
  assert.equal(result.success, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.data.leadId, 'old');
  assert.equal(added.length, 0);
});

test('force=true still allows a deliberate duplicate', async () => {
  const { main, added } = load([{ _id: 'old', phone: '13800000001' }], anchor);
  const result = await main({ phone: '13800000001', assignedSalesIds: ['sales'], force: true });
  assert.equal(result.success, true);
  assert.equal(added.length, 1);
  assert.equal(added[0].data.phone, '13800000001');
});

test('a different phone is created normally and trims the input', async () => {
  const { main, added } = load([{ _id: 'old', phone: '13800000001' }], anchor);
  const result = await main({ phone: ' 13800000002 ', assignedSalesIds: ['sales'] });
  assert.equal(result.success, true);
  assert.equal(added[0].data.phone, '13800000002');
  assert.equal(added[0].data.lastStatus, 'NEW');
});

test('name-only leads are not treated as duplicates of each other', async () => {
  // 组内已有仅名称、无电话的线索，新建同样「只填名称」的客户应成功
  const existing = [
    { _id: 'a', groupId: 2, phone: '', customerName: '客户甲' },
    { _id: 'b', groupId: 2, phone: '', customerName: '客户乙' }
  ];
  const { main, added } = load(existing, anchor);
  const result = await main({ customerName: '客户丙' });
  assert.equal(result.success, true);
  assert.equal(result.duplicate, undefined);
  assert.equal(added.length, 1);
  assert.equal(added[0].data.customerName, '客户丙');
  assert.equal(added[0].data.phone, '');
});

test('name-only lead still does not bypass phone deduplication', async () => {
  // 有电话时查重照旧生效
  const { main, added } = load([{ _id: 'old', groupId: 2, phone: '13800000001' }], anchor);
  const result = await main({ phone: '13800000001', customerName: '同名客户' });
  assert.equal(result.success, false);
  assert.equal(result.duplicate, true);
  assert.equal(added.length, 0);
});

test('non-boolean force and non-anchor roles are rejected', async () => {
  const { main, added } = load([], anchor);
  assert.equal((await main({ phone: '13800000002', assignedSalesIds: ['sales'], force: 'yes' })).success, false);

  const sales = load([], { _id: 'sales', role: 2, groupId: 2 });
  assert.equal((await sales.main({ phone: '13800000002' })).success, false);
  assert.equal(sales.added.length, 0);
  assert.equal(added.length, 0);
});
