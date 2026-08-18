import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { DraftNotFoundError } from './errors';
import { DraftService } from './draftService';

test('createDraft stores a draft with no metadata by default', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DraftService(client);

    const draft = await service.createDraft({
      workspaceId,
      type: 'email',
      content: 'Hi Acme, following up on the redesign timeline...',
    });

    assert.equal(draft.workspaceId, workspaceId);
    assert.equal(draft.type, 'email');
    assert.equal(draft.title, null);
    assert.deepEqual(draft.metadata, {});
    assert.ok(draft.createdAt);
    assert.ok(draft.updatedAt);
  });
});

test('createDraft accepts an explicit title and metadata', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new DraftService(client);

    const draft = await service.createDraft({
      workspaceId,
      type: 'proposal',
      title: 'Acme website redesign',
      content: 'Proposal body...',
      metadata: { client: 'Acme' },
    });

    assert.equal(draft.title, 'Acme website redesign');
    assert.deepEqual(draft.metadata, { client: 'Acme' });
  });
});

test('createDraft rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new DraftService(client);
    await assert.rejects(
      () =>
        service.createDraft({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          type: 'email',
          content: 'x',
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('listDrafts is scoped to the workspace and can filter by type', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new DraftService(client);

    const email = await service.createDraft({ workspaceId: a.workspaceId, type: 'email', content: 'Email draft' });
    await service.createDraft({ workspaceId: a.workspaceId, type: 'proposal', content: 'Proposal draft' });
    await service.createDraft({ workspaceId: b.workspaceId, type: 'email', content: 'Other workspace draft' });

    const allInA = await service.listDrafts(a.workspaceId);
    assert.equal(allInA.length, 2);
    assert.ok(allInA.every((draft) => draft.workspaceId === a.workspaceId));

    const emailsInA = await service.listDrafts(a.workspaceId, 'email');
    assert.equal(emailsInA.length, 1);
    assert.equal(emailsInA[0].id, email.id);
  });
});

test('getDraft throws DraftNotFoundError for an id in a different workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new DraftService(client);

    const draft = await service.createDraft({ workspaceId: a.workspaceId, type: 'email', content: 'x' });

    await assert.rejects(() => service.getDraft(b.workspaceId, draft.id), DraftNotFoundError);
  });
});

test('updateDraft updates only the provided fields', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const service = new DraftService(client);

    const draft = await service.createDraft({
      workspaceId,
      type: 'report',
      title: 'Weekly report',
      content: 'Draft 1',
    });
    const updated = await service.updateDraft(workspaceId, draft.id, { content: 'Draft 2' });

    assert.equal(updated.content, 'Draft 2');
    assert.equal(updated.title, 'Weekly report');
  });
});

test('updateDraft throws DraftNotFoundError for a cross-workspace id', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new DraftService(client);

    const draft = await service.createDraft({ workspaceId: a.workspaceId, type: 'email', content: 'x' });

    await assert.rejects(
      () => service.updateDraft(b.workspaceId, draft.id, { content: 'hijacked' }),
      DraftNotFoundError,
    );

    const stillOriginal = await service.getDraft(a.workspaceId, draft.id);
    assert.equal(stillOriginal.content, 'x');
  });
});

test('deleteDraft removes the draft; throws for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'personal');
    const service = new DraftService(client);

    const draft = await service.createDraft({ workspaceId, type: 'client_response', content: 'Delete me' });
    await service.deleteDraft(workspaceId, draft.id);

    await assert.rejects(() => service.getDraft(workspaceId, draft.id), DraftNotFoundError);
    await assert.rejects(() => service.deleteDraft(workspaceId, draft.id), DraftNotFoundError);
  });
});

test('deleteDraft throws DraftNotFoundError when the id belongs to a different workspace and does not delete it', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new DraftService(client);

    const draft = await service.createDraft({ workspaceId: a.workspaceId, type: 'email', content: 'Protected' });

    await assert.rejects(() => service.deleteDraft(b.workspaceId, draft.id), DraftNotFoundError);

    const stillThere = await service.getDraft(a.workspaceId, draft.id);
    assert.equal(stillThere.id, draft.id);
  });
});
