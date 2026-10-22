const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Isolated cloud-function harness: no SDK installation, credentials or cloud writes.
function load(name, user, lead = {}, options = {}) {
  const calls = [];
  const db = {
    command: Object.fromEntries(['in', 'and', 'or', 'exists', 'gte', 'lt'].map(key => [key, values => ({ [key]: values })])),
    RegExp: value => ({ regex: value }),
    collection(collection) {
      const query = {
        where(value) { this.filter = value; calls.push({ collection, where: value }); return this; },
        orderBy() { return this; },
        skip(value) { calls.push({ skip: value }); return this; },
        limit(value) { calls.push({ limit: value }); return this; },
        field() { return this; },
        doc() { this.isDoc = true; return this; },
        async get() {
          if (this.isDoc) return { data: lead };
          if (collection === 'users' && this.filter && this.filter.role === 2 && options.members) return { data: options.members };
          if (!this.filter && options.collections && options.collections[collection]) return { data: options.collections[collection] };
          if (collection === 'users') return { data: [user] };
          return { data: this.isDoc ? lead : [] };
        },
        async count() { return { total: 0 }; },
        async update(value) { Object.assign(lead, value.data); calls.push({ update: value }); return {}; },
        async add(value) { calls.push({ add: value }); return { _id: 'new-lead' }; }
      };
      return query;
    }
  };
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'test-openid' }) };
  const localRequire = createRequire(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'));
  const sandbox = { exports: {}, require: id => {
    if (id === 'wx-server-sdk') return cloud;
    return localRequire(id);
  }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', name, 'index.js'), 'utf8'), sandbox);
  return { main: sandbox.exports.main, calls };
}

test('sales list requires both current group and assignment', async () => {
  const { main, calls } = load('leadList', { _id: 'sales', role: 2, groupId: 2 });
  assert.equal((await main({})).success, true);
  const query = calls.find(call => call.collection === 'leads').where;
  assert.equal(query.groupId, 2);
  assert.equal(query.assignedSalesIds, 'sales');
});

test('unassigned users cannot list leads or follow-ups or create leads', async () => {
  for (const role of [1, 2]) {
    for (const name of ['leadList', 'followUpList', ...(role === 1 ? ['leadCreate'] : [])]) {
      const { main, calls } = load(name, { _id: 'user', role, groupId: 0 });
      assert.equal((await main({ leadId: 'lead', phone: 'test' })).success, false);
      assert.equal(calls.some(call => call.collection === 'leads' || call.add), false);
    }
  }
});

test('sales cannot read old-group follow-ups even if still assigned', async () => {
  const { main, calls } = load('followUpList', { _id: 'sales', role: 2, groupId: 2 },
    { groupId: 1, assignedSalesIds: ['sales'] });
  assert.equal((await main({ leadId: 'lead' })).success, false);
  assert.equal(calls.some(call => call.collection === 'followUps'), false);
});

test('same-group assigned sales can read follow-ups', async () => {
  const { main } = load('followUpList', { _id: 'sales', role: 2, groupId: 1 },
    { groupId: 1, assignedSalesIds: ['sales'] });
  assert.equal((await main({ leadId: 'lead' })).success, true);
});

test('malformed assignments do not grant follow-up access', async () => {
  const { main } = load('followUpList', { _id: 'sales', role: 2, groupId: 1 },
    { groupId: 1, assignedSalesIds: 'sales' });
  assert.equal((await main({ leadId: 'lead' })).success, false);
});

test('invalid pagination is rejected before querying leads', async () => {
  for (const params of [{ page: 0 }, { page: -1 }, { page: '2' }, { page: 1.5 },
    { pageSize: 0 }, { pageSize: 101 }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }]) {
    const { main, calls } = load('leadList', { _id: 'admin', role: 0 });
    assert.equal((await main(params)).success, false);
    assert.equal(calls.some(call => call.collection === 'leads'), false);
  }
});

test('pagination defaults and offset remain compatible', async () => {
  const { main, calls } = load('leadList', { _id: 'admin', role: 0 });
  const result = await main({ page: 3, pageSize: 10 });
  assert.equal(result.success, true);
  assert.equal(result.data.page, 3);
  assert.equal(calls.find(call => call.skip !== undefined).skip, 20);
  assert.equal((await main()).data.pageSize, 20);
});

test('new leads have NEW filter status and malformed phone is rejected', async () => {
  const { main, calls } = load('leadCreate', { _id: 'sales', role: 1, groupId: 1 });
  assert.equal((await main({ phone: 123 })).success, false);
  const result = await main({ phone: ' example ', assignedSalesIds: ['sales'] });
  assert.equal(result.success, true);
  assert.equal(calls.find(call => call.add).add.data.lastStatus, 'NEW');
});

test('combined search, status and detail filters retain sales group restrictions', async () => {
  const { main, calls } = load('leadList', { _id: 'sales', role: 2, groupId: 2 });
  const result = await main({ keyword: 'test.*', status: 'NEW', leadId: 'lead', unfollowed: true, createdFrom: '2026-10-01' });
  assert.equal(result.success, true);
  const where = calls.find(call => call.collection === 'leads').where;
  assert.equal(where.and[0].and[0].groupId, 2);
  assert.equal(where.and[0].and[0].assignedSalesIds, 'sales');
  assert.equal(where.and[1]._id, 'lead');
});

test('invalid filter input returns a readable failure before database query', async () => {
  for (const params of [{ status: 'INVALID' }, { sort: 'phone' }, { createdFrom: '2026-02-30' }]) {
    const { main, calls } = load('leadList', { _id: 'sales', role: 2, groupId: 2 });
    assert.equal((await main(params)).success, false);
    assert.equal(calls.some(call => call.collection === 'leads'), false);
  }
});

test('teams above four work without broadening member scope', async () => {
  const { main, calls } = load('leadList', { _id: 'member', role: 2, groupId: 105 });
  assert.equal((await main({})).success, true);
  assert.equal(calls.find(call => call.collection === 'leads').where.groupId, 105);
});

test('solo manager creates a named item without requiring phone or members', async () => {
  const { main, calls } = load('leadCreate', { _id: 'manager', role: 1, groupId: 42 }, {}, { members: [] });
  const result = await main({ customerName: '服务事项' });
  assert.equal(result.success, true);
  const data = calls.find(call => call.add).add.data;
  assert.equal(data.customerName, '服务事项');
  assert.equal(data.phone, '');
  assert.equal(data.assignedSalesIds[0], 'manager');
});

test('generic item still requires name or phone and validates field types', async () => {
  for (const event of [{}, { customerName: [] }, { customerName: 'x', remarks: {} }]) {
    const { main, calls } = load('leadCreate', { _id: 'manager', role: 1, groupId: 1 });
    assert.equal((await main(event)).success, false);
    assert.equal(calls.some(call => call.add), false);
  }
});

test('admin assigns arbitrary positive team IDs and normalizes promoted admin team', async () => {
  const target = { _id: 'target', role: 2, groupId: 1 };
  const { main, calls } = load('adminUserUpdate', { _id: 'admin', role: 0 }, target);
  assert.equal((await main({ userId: 'target', groupId: 88 })).success, true);
  assert.equal(target.groupId, 88);
  assert.equal((await main({ userId: 'target', role: 0 })).success, true);
  assert.equal(calls[calls.length - 1].update.data.groupId, 0);
});

test('dashboard discovers actual teams instead of inventing four empty groups', async () => {
  const admin = { _id: 'admin', role: 0, groupId: 0 };
  const manager = { _id: 'manager', role: 1, groupId: 42 };
  const { main } = load('adminDashboard', admin, {}, { collections: {
    users: [admin, manager], leads: [], followUps: []
  } });
  const result = await main({});
  assert.equal(result.success, true);
  assert.equal(result.data.groupStats.length, 1);
  assert.equal(result.data.groupStats[0].groupId, 42);
});

test('invalid team assignments are rejected without updating users', async () => {
  for (const groupId of [-1, 1.5, '9', Number.MAX_SAFE_INTEGER + 1]) {
    const { main, calls } = load('adminUserUpdate', { _id: 'admin', role: 0 }, { role: 2, groupId: 1 });
    assert.equal((await main({ userId: 'target', groupId })).success, false);
    assert.equal(calls.some(call => call.update), false);
  }
});

test('group members works for teams above four and rejects invalid teams', async () => {
  const { main, calls } = load('groupMembers', { _id: 'manager', role: 1, groupId: 42 }, {},
    { members: [{ _id: 's42', name: '销售42' }] });
  const ok = await main({});
  assert.equal(ok.success, true);
  assert.equal(ok.data.groupId, 42);
  assert.equal(ok.data.list.length, 1);
  const membersWhere = calls.filter(call => call.collection === 'users')
    .map(call => call.where).find(where => where && where.role === 2);
  assert.equal(membersWhere.groupId, 42);

  const unassigned = load('groupMembers', { _id: 'manager', role: 1, groupId: 0 });
  assert.equal((await unassigned.main({})).success, false);
});

test('public role and workflow labels use general-purpose vocabulary', () => {
  const { roleName } = require('../miniprogram/utils/auth');
  const { getStatusText } = require('../miniprogram/utils/status');
  assert.equal(roleName(1), '负责人');
  assert.equal(roleName(2), '成员');
  assert.equal(getStatusText('WON'), '已完成');
  assert.equal(getStatusText('LOST'), '已关闭');
});
