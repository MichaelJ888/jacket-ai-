import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCloudRunner, REQUIRED_SECRETS } from './bootstrap-secrets.mjs';

function fakeGitHub({ present = [], state = 'active', status = 200 } = {}) {
  const names = new Set(present);
  return {
    names,
    fetcher: async (url) => String(url).includes('/actions/secrets')
      ? Response.json({ secrets: [...names].map((name) => ({ name })) }, { status })
      : Response.json({ state }),
  };
}

test('default audit is read-only and names do not prove execution', async () => {
  const api = fakeGitHub({ present: REQUIRED_SECRETS });
  const result = await auditCloudRunner({ repo: 'owner/repo', env: { GITHUB_PAT: 'private-token' }, fetcher: api.fetcher, run: () => { throw new Error('must not spawn'); } });
  assert.equal(result.ready, true);
  assert.match(result.verification, /end-to-end execution are not verified/);
  assert.ok(!JSON.stringify(result).includes('private-token'));
});

test('sync encrypts available missing secrets via CLI stdin, not args, without overwriting existing names', async () => {
  const api = fakeGitHub({ present: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] });
  const calls = [];
  const result = await auditCloudRunner({
    repo: 'owner/repo', env: { GITHUB_PAT: 'private-pat', SUPABASE_SERVICE_ROLE_KEY: 'private-service-key', NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid', TELEGRAM_BOT_TOKEN: 'never-overwrite' },
    syncMissing: true, fetcher: api.fetcher,
    run: (exe, args, options) => {
      if (args[0] === '--version') return { status: 0, stdout: 'gh version 2.0' };
      assert.equal(args.includes('private-service-key'), false);
      assert.equal(options.env.GH_TOKEN, 'private-pat');
      calls.push({ name: args[2], stdin: options.input });
      api.names.add(args[2]);
      return { status: 0 };
    },
  });
  assert.deepEqual(calls.map((call) => call.name), ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']);
  assert.equal(calls[0].stdin, 'private-service-key');
  assert.deepEqual(result.missing, ['COPILOT_GITHUB_TOKEN']);
  assert.deepEqual(result.unavailableLocally, ['COPILOT_GITHUB_TOKEN']);
  assert.equal(result.ready, false);
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('disabled workflow and denied metadata cannot report ready', async () => {
  const inactive = fakeGitHub({ present: REQUIRED_SECRETS, state: 'disabled_manually' });
  assert.equal((await auditCloudRunner({ repo: 'a/b', env: { GITHUB_PAT: 'token' }, fetcher: inactive.fetcher })).ready, false);
  await assert.rejects(auditCloudRunner({ repo: 'a/b', env: { GITHUB_PAT: 'token' }, fetcher: fakeGitHub({ status: 403 }).fetcher }), /HTTP 403/);
});

test('invalid repository and missing CLI fail explicitly without secret output', async () => {
  await assert.rejects(auditCloudRunner({ repo: '--names-only', env: {} }), /Expected owner\/repo/);
  await assert.rejects(auditCloudRunner({
    repo: 'a/b', env: { GITHUB_PAT: 'token', SUPABASE_SERVICE_ROLE_KEY: 'private-value' }, syncMissing: true,
    fetcher: fakeGitHub().fetcher, run: () => ({ status: null, error: new Error('not found') }),
  }), /GitHub CLI is unavailable/);
});

test('CLI failure is sanitized and sync verification is mandatory', async () => {
  for (const success of [false, true]) {
    await assert.rejects(auditCloudRunner({
      repo: 'a/b', env: { GITHUB_PAT: 'token', SUPABASE_SERVICE_ROLE_KEY: 'private-value' }, syncMissing: true, fetcher: fakeGitHub().fetcher,
      run: (exe, args) => args[0] === '--version' ? { status: 0, stdout: 'gh version 2.0' } : { status: success ? 0 : 1, stderr: 'private-value' },
    }), success ? /could not be verified/ : /failed for SUPABASE_SERVICE_ROLE_KEY/);
  }
});
