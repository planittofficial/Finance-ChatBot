'use strict';

/**
 * tests/api.test.js
 * ──────────────────
 * Smoke-test the full chatbot API end-to-end.
 * Run: node tests/api.test.js
 *
 * Expects the server to be running on PORT (default 3000).
 * Uses only built-in Node.js fetch (v18+) — no extra test dependencies.
 */

const BASE = `http://localhost:${process.env.PORT || 3000}`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  return { status: res.status, json };
}

async function del(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  const json = await res.json();
  return { status: res.status, json };
}

// ─── Test answers for the 6 collection steps ─────────────────────────────────
const ANSWERS = ['28', '75000', '45000', '200000', 'moderate', 'wealth'];

// ─── Run Tests ────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log('\x1b[36m  FinanceAI API Smoke Tests\x1b[0m');
  console.log('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  // 1. Health check
  await test('GET /health returns ok', async () => {
    const { status, json } = await get('/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.status === 'ok', 'Expected status: ok');
    assert(typeof json.uptime === 'number', 'Expected uptime number');
    assert(typeof json.model === 'string', 'Expected model string');
    console.log(`    → uptime: ${json.uptime}s, model: ${json.model}`);
  });

  // 2. API root
  await test('GET /api returns endpoint list', async () => {
    const { status, json } = await get('/api');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.endpoints, 'Expected endpoints object');
  });

  // 3. Start session
  let sessionId;
  await test('POST /api/chat/start creates session', async () => {
    const { status, json } = await post('/api/chat/start', {});
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.sessionId, 'Missing sessionId');
    assert(json.message, 'Missing first message');
    assert(json.phase === 'collect', 'Expected phase: collect');
    assert(json.step, 'Missing step metadata');
    assert(json.step.field === 'age', `Expected step field: age, got ${json.step.field}`);
    sessionId = json.sessionId;
    console.log(`    → sessionId: ${sessionId.slice(0, 8)}...`);
    console.log(`    → first message: "${json.message.slice(0, 60)}..."`);
  });

  // 4. Send an off-topic message during collect
  await test('Off-topic message is redirected gracefully', async () => {
    const { status, json } = await post('/api/chat/message', {
      sessionId,
      message: 'What is the capital of France?',
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.message, 'No message returned');
    assert(json.phase === 'collect', 'Phase should still be collect');
    console.log(`    → redirect: "${json.message.slice(0, 70)}..."`);
  });

  // 5. Walk through all 6 collection steps
  let finalResponse;
  for (let i = 0; i < ANSWERS.length; i++) {
    const answer = ANSWERS[i];
    await test(`Collection step ${i + 1}/6 — answer: "${answer}"`, async () => {
      const { status, json } = await post('/api/chat/message', { sessionId, message: answer });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.message, 'No message returned');

      // Last step triggers analysis
      if (i === ANSWERS.length - 1) {
        finalResponse = json;
        console.log(`    → phase: ${json.phase}`);
        console.log(`    → has analysis: ${!!json.analysis}`);
      } else {
        assert(json.phase === 'collect', `Expected collect, got ${json.phase}`);
        console.log(`    → progress: ${json.progress}%`);
      }
    });
  }

  // 6. Analysis result shape
  await test('Analysis response has correct shape', async () => {
    assert(finalResponse, 'No final response captured');
    const a = finalResponse.analysis;
    assert(a, 'analysis missing from response');
    assert(a.projections, 'projections missing');
    assert(Array.isArray(a.insights), 'insights is not an array');
    assert(a.insights.length === 3, `Expected 3 insights, got ${a.insights.length}`);
    assert(typeof a.wealth_gap === 'number', 'wealth_gap not a number');
    assert(typeof a.hook_line === 'string', 'hook_line not a string');
    assert(Array.isArray(a.quick_wins), 'quick_wins not an array');
    const p = a.projections;
    const fields = ['current_3yr','current_5yr','current_10yr','optimized_3yr','optimized_5yr','optimized_10yr','max_10yr'];
    fields.forEach(f => assert(typeof p[f] === 'number' && p[f] > 0, `projections.${f} invalid: ${p[f]}`));
    console.log(`    → wealth_gap: ₹${a.wealth_gap.toLocaleString('en-IN')}`);
    console.log(`    → hook: "${a.hook_line}"`);
    console.log(`    → 10yr optimized: ₹${a.projections.optimized_10yr.toLocaleString('en-IN')}`);
  });

  // 7. Freeform Q&A
  await test('Freeform financial question gets a response', async () => {
    const { status, json } = await post('/api/chat/message', {
      sessionId,
      message: 'What SIP amount should I start with?',
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.message && json.message.length > 20, 'Response too short');
    console.log(`    → reply: "${json.message.slice(0, 80)}..."`);
  });

  // 8. Off-topic in freeform
  await test('Off-topic in freeform phase is redirected', async () => {
    const { status, json } = await post('/api/chat/message', {
      sessionId,
      message: 'Can you write me a poem about cats?',
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.message, 'No message returned');
    console.log(`    → reply: "${json.message.slice(0, 80)}..."`);
  });

  // 9. GET session state
  await test('GET /api/chat/session/:id returns full state', async () => {
    const { status, json } = await get(`/api/chat/session/${sessionId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.profile, 'Missing profile');
    assert(json.profile.age === 28, `Expected age 28, got ${json.profile.age}`);
    assert(json.profile.income === 75000, `Expected income 75000, got ${json.profile.income}`);
    assert(json.analysis, 'Missing analysis');
    assert(json.history.length > 0, 'History should not be empty');
    console.log(`    → history length: ${json.history.length} messages`);
  });

  // 10. Invalid message (empty)
  await test('Empty message returns 400', async () => {
    const { status } = await post('/api/chat/message', { sessionId, message: '' });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // 11. Missing sessionId
  await test('Missing sessionId returns 400', async () => {
    const { status } = await post('/api/chat/message', { message: 'hi' });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // 12. Expired/non-existent session
  await test('Expired session returns 404', async () => {
    const { status, json } = await post('/api/chat/message', {
      sessionId: 'non-existent-session-id-12345',
      message:   'hello',
    });
    assert(status === 404, `Expected 404, got ${status}`);
    assert(json.code === 'SESSION_EXPIRED', `Expected SESSION_EXPIRED code`);
  });

  // 13. Delete session
  await test('DELETE /api/chat/session/:id removes session', async () => {
    const { status, json } = await del(`/api/chat/session/${sessionId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.success === true, 'Expected success: true');

    // Verify it's gone
    const check = await get(`/api/chat/session/${sessionId}`);
    assert(check.status === 404, `Session should be gone, got ${check.status}`);
  });

  // 14. 404 on unknown route
  await test('Unknown route returns 404', async () => {
    const { status } = await get('/api/unknown-route');
    assert(status === 404, `Expected 404, got ${status}`);
  });

  // ─── Results ───────────────────────────────────────────────────────────────
  console.log('\n\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\x1b[31m[TEST RUNNER ERROR]\x1b[0m', err.message);
  console.error('Make sure the server is running: npm run dev');
  process.exit(1);
});
