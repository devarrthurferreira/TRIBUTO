import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformMySqlStore } from '../src/platform/mysql-store.mjs';

test('esquema MySQL aceita cadastro inicial quando a contagem zero vem como texto', async () => {
  const events = [];
  let userCount = '0';
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async execute(sql) {
      if (sql.startsWith('SELECT COUNT')) return [[{ n: userCount }]];
      if (sql.includes('INSERT INTO platform_users')) events.push('insert user');
      return [[]];
    },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); }
  };
  const store = new PlatformMySqlStore({ async getConnection() { return connection; } });
  const admin = {
    _id: 'a8f45eef-9b1a-41ad-ab83-06919fd88d31',
    name: 'Programação',
    email: 'admin@example.test',
    passwordHash: 'hash-de-teste',
    role: 'admin',
    active: true,
    companyCnpjs: [],
    moduleGrants: {},
    createdAt: new Date('2026-01-01T00:00:00Z')
  };

  await store.createFirstAdmin(admin);
  assert.deepEqual(events, ['begin', 'insert user', 'commit', 'release']);

  events.length = 0;
  userCount = '1';
  await assert.rejects(store.createFirstAdmin(admin), { message: 'SETUP_COMPLETE' });
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});
