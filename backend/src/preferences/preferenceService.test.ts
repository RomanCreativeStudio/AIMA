import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { WorkspaceNotFoundError } from '../types/errors';
import { PreferenceNotFoundError } from './errors';
import { PreferenceService } from './preferenceService';

test('setPreference creates a new preference', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new PreferenceService(client);

    const preference = await service.setPreference({
      workspaceId,
      category: 'writing_style',
      key: 'tone',
      value: 'formal',
    });

    assert.equal(preference.workspaceId, workspaceId);
    assert.equal(preference.category, 'writing_style');
    assert.equal(preference.key, 'tone');
    assert.equal(preference.value, 'formal');
  });
});

test('setPreference upserts on (workspace, category, key) instead of duplicating', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = new PreferenceService(client);

    await service.setPreference({ workspaceId, category: 'writing_style', key: 'tone', value: 'formal' });
    const updated = await service.setPreference({
      workspaceId,
      category: 'writing_style',
      key: 'tone',
      value: 'casual',
    });

    const all = await service.listPreferences(workspaceId);
    assert.equal(all.length, 1);
    assert.equal(all[0].value, 'casual');
    assert.equal(all[0].id, updated.id);
  });
});

test('setPreference rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = new PreferenceService(client);
    await assert.rejects(
      () =>
        service.setPreference({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          category: 'writing_style',
          key: 'tone',
          value: 'formal',
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('listPreferences is scoped to the workspace and can filter by category', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new PreferenceService(client);

    await service.setPreference({ workspaceId: a.workspaceId, category: 'writing_style', key: 'tone', value: 'formal' });
    await service.setPreference({
      workspaceId: a.workspaceId,
      category: 'workflow_preferences',
      key: 'review_cadence',
      value: 'weekly',
    });
    await service.setPreference({
      workspaceId: b.workspaceId,
      category: 'writing_style',
      key: 'tone',
      value: 'playful',
    });

    const allInA = await service.listPreferences(a.workspaceId);
    assert.equal(allInA.length, 2);
    assert.ok(allInA.every((preference) => preference.workspaceId === a.workspaceId));

    const writingStyleInA = await service.listPreferences(a.workspaceId, 'writing_style');
    assert.equal(writingStyleInA.length, 1);
    assert.equal(writingStyleInA[0].key, 'tone');
    assert.equal(writingStyleInA[0].value, 'formal');
  });
});

test('getPreference throws PreferenceNotFoundError across workspaces (isolation)', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new PreferenceService(client);

    const preference = await service.setPreference({
      workspaceId: a.workspaceId,
      category: 'project_rules',
      key: 'deploy_freeze',
      value: 'no deploys after 5pm',
    });

    await assert.rejects(() => service.getPreference(b.workspaceId, preference.id), PreferenceNotFoundError);
  });
});

test('deletePreference removes the preference; throws for an unknown id', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'development');
    const service = new PreferenceService(client);

    const preference = await service.setPreference({
      workspaceId,
      category: 'response_preferences',
      key: 'verbosity',
      value: 'concise',
    });
    await service.deletePreference(workspaceId, preference.id);

    await assert.rejects(() => service.getPreference(workspaceId, preference.id), PreferenceNotFoundError);
    await assert.rejects(() => service.deletePreference(workspaceId, preference.id), PreferenceNotFoundError);
  });
});

test('deletePreference throws PreferenceNotFoundError when the id belongs to a different workspace and does not delete it', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new PreferenceService(client);

    const preference = await service.setPreference({
      workspaceId: a.workspaceId,
      category: 'writing_style',
      key: 'tone',
      value: 'formal',
    });

    await assert.rejects(() => service.deletePreference(b.workspaceId, preference.id), PreferenceNotFoundError);

    const stillThere = await service.getPreference(a.workspaceId, preference.id);
    assert.equal(stillThere.id, preference.id);
  });
});
