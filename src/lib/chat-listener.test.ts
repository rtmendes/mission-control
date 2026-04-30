import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentReplyForChat } from './chat-listener';

test('completion-style agent replies are captured for Chat instead of swallowed', () => {
  const normalized = normalizeAgentReplyForChat('TASK_COMPLETE: Built the app and handed off to Tester Agent');

  assert.equal(normalized.action, 'store');
  assert.equal(normalized.kind, 'completion');
  assert.match(normalized.content, /Task complete/);
  assert.match(normalized.content, /Built the app/);
});

test('dispatch prompt leakage is still ignored', () => {
  const normalized = normalizeAgentReplyForChat('NEW TASK ASSIGNED\nOUTPUT DIRECTORY: /tmp/work\nDo the thing');

  assert.equal(normalized.action, 'ignore');
  assert.equal(normalized.kind, 'prompt_leak');
});
