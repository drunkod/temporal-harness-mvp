import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { collectObservation, observationProbeExpression, parseOptions } from '../scripts/flowdeck-observation-probe.mjs';

const url = 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/c/00000000-0000-0000-0000-000000000001';
const args = ['--tab', 'exact-tab', '--url', url];
const element = (role, innerText, textContent = innerText) => ({
  innerText, textContent, getAttribute: key => key === 'data-message-author-role' ? role : null,
  getClientRects: () => [{}],
});
function dom({ assistantInner = 'PRIVATE_RESPONSE', assistantText = assistantInner, mainInner = 'You said:\nPRIVATE_PROMPT\nChatGPT said:\nPRIVATE_RESPONSE' } = {}) {
  const user = element('user', 'Task ID: PRIVATE_TASK\nWorktree: /private/worktree\nPRIVATE_PROMPT');
  const assistant = element('assistant', assistantInner, assistantText);
  const main = element(null, mainInner, 'PRIVATE_DOM_TEXT');
  const headings = [element(null, '', 'You said:'), element(null, '', 'ChatGPT said:')];
  const scroller = { ...element(null, ''), scrollTop: 0, scrollHeight: 2000, clientHeight: 800 };
  const document = {
    readyState: 'complete', visibilityState: 'visible', hasFocus: () => true,
    querySelector: selector => selector === 'main' ? main : null,
    querySelectorAll: selector => ({
      '[data-message-author-role]': [user, assistant], 'main h4.sr-only': headings,
      '.thread-scroll-container': [scroller], button: [],
    }[selector] ?? []),
  };
  return { document, location: { origin: 'https://chatgpt.com', pathname: new URL(url).pathname },
    getComputedStyle: () => ({ contentVisibility: 'auto', display: 'block' }) };
}

test('requires exact supported route and bounds sample count and interval', () => {
  assert.equal(parseOptions(args).samples, 3);
  for (const bad of [[], [...args, '--samples', '11'], [...args, '--samples', '0'],
    [...args, '--interval-ms', '1'], [...args, '--tab', 'duplicate'],
    ['--tab', 'exact-tab', '--url', 'https://example.com'], [...args, '--refresh', 'true']]) {
    assert.throws(() => parseOptions(bad));
  }
});

test('returns lengths and booleans, never private prompt/answer/path text', () => {
  const value = runInNewContext(observationProbeExpression(url), dom());
  assert.equal(value.parsedAssistantLength, 'PRIVATE_RESPONSE'.length);
  assert.equal(value.taskIdPresent, true);
  assert.equal(value.worktreePresent, true);
  assert.equal(value.identityUserTurns, 1);
  assert.equal(value.writes, false);
  assert.equal(value.browserSubmissions, 0);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|\/private\/worktree/);
});

test('distinguishes DOM text from empty rendered assistant without using hidden text as answer', () => {
  const value = runInNewContext(observationProbeExpression(url), dom({
    assistantInner: '', assistantText: 'PRIVATE_HIDDEN_RESPONSE', mainInner: '',
  }));
  assert.equal(value.lastAssistantInnerTextLength, 0);
  assert.ok(value.lastAssistantTextContentLength > 0);
  assert.equal(value.parsedAssistantLength, 0);
});

test('in-page route drift aborts the probe', () => {
  const context = dom(); context.location.pathname = '/c/another-chat';
  assert.throws(() => runInNewContext(observationProbeExpression(url), context), /Pinned route changed/);
});

test('missing, duplicate or wrong-route pinned targets never evaluate or select replacement', async () => {
  const options = parseOptions(args);
  const original = { type: 'page', id: options.tabId, url };
  for (const pages of [[], [{ ...original, id: 'replacement' }],
    [{ ...original, url: url + '/wrong' }], [original, original]]) {
    await assert.rejects(collectObservation(options, { pages: async () => pages,
      evaluate: () => assert.fail('must not evaluate') }), /pinned tab/);
  }
});

test('probe uses only the exact target and has no UI action instructions', async () => {
  const options = parseOptions(args);
  const result = await collectObservation(options, {
    pages: async () => [{ type: 'page', id: options.tabId, url }],
    evaluate: async (tab, expression) => {
      assert.equal(tab.id, options.tabId);
      assert.doesNotMatch(expression, /\.click\(|\.focus\(|\.reload\(|\.scrollTo\(|\.scrollBy\(|execCommand|localStorage|document\.cookie/);
      return runInNewContext(expression, dom());
    },
  });
  assert.equal(result.scrollContainerCount, 1);
});
