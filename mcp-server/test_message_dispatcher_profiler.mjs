import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentMessageDispatcher,
  runDispatcherBenchmark,
} from './message_dispatcher_profiler.mjs';

test('AgentMessageDispatcher: topic routing and wildcard subscriptions', () => {
  const dispatcher = new AgentMessageDispatcher({ capacity: 100 });
  const receivedA = [];
  const receivedAll = [];

  dispatcher.subscribe('agent-a', 'topic.task', (evt) => {
    receivedA.push(evt.payload);
  });

  const unsubscribeAll = dispatcher.subscribe('agent-wildcard', '*', (evt) => {
    receivedAll.push(evt.payload);
  });

  assert.equal(dispatcher.subscriberCount, 2);

  // Publish to topic.task -> both receive
  let delivered = dispatcher.publish('topic.task', { data: 1 });
  assert.equal(delivered, 2);
  assert.equal(receivedA.length, 1);
  assert.equal(receivedAll.length, 1);

  // Publish to topic.other -> only wildcard receives
  delivered = dispatcher.publish('topic.other', { data: 2 });
  assert.equal(delivered, 1);
  assert.equal(receivedA.length, 1);
  assert.equal(receivedAll.length, 2);

  // Unsubscribe wildcard
  unsubscribeAll();
  assert.equal(dispatcher.subscriberCount, 1);

  delivered = dispatcher.publish('topic.other', { data: 3 });
  assert.equal(delivered, 0);
});

test('AgentMessageDispatcher: input validation and boundary guards', () => {
  const dispatcher = new AgentMessageDispatcher();

  assert.throws(() => dispatcher.subscribe('', '*', () => {}), /agentId must be a non-empty string/);
  assert.throws(() => dispatcher.subscribe('agent-1', '*', null), /handler must be a callable function/);
  assert.throws(() => dispatcher.publish('', { ok: true }), /topic must be a non-empty string/);
});

test('AgentMessageDispatcher: circular ring buffer wrap-around', () => {
  const dispatcher = new AgentMessageDispatcher({ capacity: 4 });
  for (let i = 0; i < 10; i++) {
    dispatcher.publish('test.event', { i });
  }

  assert.equal(dispatcher.totalPublished, 10);
  assert.equal(dispatcher.head, 10);
  // Last slot should be sequence 9
  const lastSlot = (10 - 1) % 4;
  assert.equal(dispatcher.buffer[lastSlot].payload.i, 9);
});

test('AgentMessageDispatcher: benchmark profiler execution', () => {
  const profile = runDispatcherBenchmark(5, 5000);

  assert.equal(profile.subscribers, 5);
  assert.equal(profile.messageCount, 5000);
  assert.ok(profile.deliveredTotal > 0);
  assert.ok(profile.meanLatencyUs >= 0);
  assert.ok(profile.p50LatencyUs >= 0);
  assert.ok(profile.p90LatencyUs >= profile.p50LatencyUs);
  assert.ok(profile.p99LatencyUs >= profile.p90LatencyUs);
  assert.ok(profile.throughputOpsSec > 0);
});
