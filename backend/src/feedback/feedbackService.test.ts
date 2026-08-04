import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { FeedbackNotFoundError, InvalidFeedbackStatusTransitionError } from './errors';
import { FeedbackService } from './feedbackService';

test('createFeedback stores a submission scoped to the workspace and the submitting user', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    const service = new FeedbackService(client);

    const feedback = await service.createFeedback({
      workspaceId,
      userId,
      type: 'bug',
      message: 'The dashboard flickers on load.',
    });

    assert.equal(feedback.workspaceId, workspaceId);
    assert.equal(feedback.userId, userId);
    assert.equal(feedback.type, 'bug');
    assert.equal(feedback.message, 'The dashboard flickers on load.');
    assert.ok(feedback.createdAt);
  });
});

test('createFeedback defaults type to general when not provided', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new FeedbackService(client);

    const feedback = await service.createFeedback({ workspaceId, userId, message: 'Loving the beta so far!' });

    assert.equal(feedback.type, 'general');
  });
});

test('createFeedback rejects an unknown workspaceId with WorkspaceNotFoundError', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client, 'personal');
    const service = new FeedbackService(client);

    await assert.rejects(
      () =>
        service.createFeedback({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          userId,
          message: 'x',
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('listFeedback returns only the submissions for that workspace, newest first', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'mfs');
    const service = new FeedbackService(client);

    await service.createFeedback({ workspaceId, userId, type: 'feature', message: 'first' });
    await service.createFeedback({ workspaceId, userId, type: 'bug', message: 'second' });

    const results = await service.listFeedback(workspaceId);

    assert.equal(results.length, 2);
    assert.equal(results[0].message, 'second');
    assert.equal(results[1].message, 'first');
  });
});

test('listFeedback isolates workspaces from each other', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new FeedbackService(client);

    await service.createFeedback({ workspaceId: a.workspaceId, userId: a.userId, message: 'workspace a' });
    await service.createFeedback({ workspaceId: b.workspaceId, userId: b.userId, message: 'workspace b' });

    const resultsA = await service.listFeedback(a.workspaceId);
    const resultsB = await service.listFeedback(b.workspaceId);

    assert.equal(resultsA.length, 1);
    assert.equal(resultsA[0].message, 'workspace a');
    assert.equal(resultsB.length, 1);
    assert.equal(resultsB[0].message, 'workspace b');
  });
});

test('listFeedback rejects an unknown workspaceId with WorkspaceNotFoundError', async () => {
  await withTestTransaction(async (client) => {
    const service = new FeedbackService(client);
    await assert.rejects(
      () => service.listFeedback('00000000-0000-0000-0000-000000000000'),
      WorkspaceNotFoundError,
    );
  });
});

test('updateStatus advances new -> reviewed', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    const service = new FeedbackService(client);
    const feedback = await service.createFeedback({ workspaceId, userId, message: 'x' });

    const updated = await service.updateStatus(feedback.id, 'reviewed');

    assert.equal(updated.status, 'reviewed');
    assert.equal(updated.id, feedback.id);
  });
});

test('updateStatus advances reviewed -> resolved', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new FeedbackService(client);
    const feedback = await service.createFeedback({ workspaceId, userId, message: 'x' });
    await service.updateStatus(feedback.id, 'reviewed');

    const updated = await service.updateStatus(feedback.id, 'resolved');

    assert.equal(updated.status, 'resolved');
  });
});

test('updateStatus rejects skipping a step (new -> resolved)', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'mfs');
    const service = new FeedbackService(client);
    const feedback = await service.createFeedback({ workspaceId, userId, message: 'x' });

    await assert.rejects(
      () => service.updateStatus(feedback.id, 'resolved'),
      InvalidFeedbackStatusTransitionError,
    );
  });
});

test('updateStatus rejects moving backward (reviewed -> new)', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'personal');
    const service = new FeedbackService(client);
    const feedback = await service.createFeedback({ workspaceId, userId, message: 'x' });
    await service.updateStatus(feedback.id, 'reviewed');

    await assert.rejects(
      () => service.updateStatus(feedback.id, 'new'),
      InvalidFeedbackStatusTransitionError,
    );
  });
});

test('updateStatus rejects any transition once resolved is terminal', async () => {
  await withTestTransaction(async (client) => {
    const { userId, workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new FeedbackService(client);
    const feedback = await service.createFeedback({ workspaceId, userId, message: 'x' });
    await service.updateStatus(feedback.id, 'reviewed');
    await service.updateStatus(feedback.id, 'resolved');

    await assert.rejects(
      () => service.updateStatus(feedback.id, 'reviewed'),
      InvalidFeedbackStatusTransitionError,
    );
  });
});

test('updateStatus rejects an unknown feedbackId with FeedbackNotFoundError', async () => {
  await withTestTransaction(async (client) => {
    const service = new FeedbackService(client);

    await assert.rejects(
      () => service.updateStatus('00000000-0000-0000-0000-000000000000', 'reviewed'),
      FeedbackNotFoundError,
    );
  });
});
