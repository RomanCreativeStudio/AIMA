import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { UserService } from '../users/userService';
import type { UpdateUserProfileInput } from '../users/types';
import type { NotificationService } from '../notifications/types';
import type { Invitation } from './types';
import { UserAlreadyBetaTesterError } from './errors';
import { InvitationService } from './invitationService';

class RecordingNotificationService implements NotificationService {
  calls: Invitation[] = [];

  async notifyInvitationCreated(invitation: Invitation): Promise<void> {
    this.calls.push(invitation);
  }
}

class ThrowingNotificationService implements NotificationService {
  async notifyInvitationCreated(): Promise<void> {
    throw new Error('webhook unreachable');
  }
}

test('createInvitation stores an invitation with pending status and an inviter', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);

    const invitation = await service.createInvitation({ email: 'prospect@example.com', invitedBy: userId });

    assert.equal(invitation.email, 'prospect@example.com');
    assert.equal(invitation.invitedBy, userId);
    assert.equal(invitation.status, 'pending');
    assert.ok(invitation.createdAt);
  });
});

test('createInvitation rejects an email already belonging to an active beta tester', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const { userId: betaUserId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const update: UpdateUserProfileInput = { preferences: { betaTester: true } };
    const betaUser = await userService.updateProfile(betaUserId, update);
    const service = new InvitationService(client, userService);

    await assert.rejects(
      () => service.createInvitation({ email: betaUser.email, invitedBy: adminId }),
      UserAlreadyBetaTesterError,
    );
  });
});

test('createInvitation allows inviting an email that belongs to a non-beta-tester user', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const { userId: regularUserId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const regularUser = await userService.getUser(regularUserId);
    const service = new InvitationService(client, userService);

    const invitation = await service.createInvitation({ email: regularUser.email, invitedBy: adminId });

    assert.equal(invitation.email, regularUser.email);
  });
});

test('createInvitation notifies the configured NotificationService with the created invitation', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const notificationService = new RecordingNotificationService();
    const service = new InvitationService(client, userService, notificationService);

    const invitation = await service.createInvitation({ email: 'notify-me@example.com', invitedBy: userId });

    assert.equal(notificationService.calls.length, 1);
    assert.deepEqual(notificationService.calls[0], invitation);
  });
});

test('createInvitation still returns the created invitation when the NotificationService throws', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService, new ThrowingNotificationService());

    const invitation = await service.createInvitation({ email: 'still-created@example.com', invitedBy: userId });

    assert.equal(invitation.email, 'still-created@example.com');
    assert.equal(invitation.status, 'pending');

    const listed = await service.listInvitations();
    assert.ok(listed.some((i) => i.id === invitation.id));
  });
});

test('listInvitations returns newest first', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);

    const first = await service.createInvitation({ email: 'first@example.com', invitedBy: userId });
    const second = await service.createInvitation({ email: 'second@example.com', invitedBy: userId });

    const listed = await service.listInvitations();
    const firstIndex = listed.findIndex((i) => i.id === first.id);
    const secondIndex = listed.findIndex((i) => i.id === second.id);
    assert.ok(secondIndex < firstIndex);
  });
});

// Invitation Acceptance & Lifecycle sprint.

test('acceptInvitationFor transitions a matching pending invitation to accepted and promotes the user to betaTester', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const inviteeEmail = 'invitee@example.com';
    const invitation = await service.createInvitation({ email: inviteeEmail, invitedBy: adminId });
    const invitee = await userService.createUser({ email: inviteeEmail });

    await service.acceptInvitationFor(inviteeEmail, invitee.id);

    const [accepted] = (await service.listInvitations()).filter((i) => i.id === invitation.id);
    assert.equal(accepted.status, 'accepted');
    const updated = await userService.getUser(invitee.id);
    assert.equal(updated.preferences.betaTester, true);
  });
});

test('acceptInvitationFor is a no-op for an email with no pending invitation', async () => {
  await withTestTransaction(async (client) => {
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const user = await userService.createUser({ email: 'no-invite@example.com' });

    await assert.doesNotReject(() => service.acceptInvitationFor('no-invite@example.com', user.id));

    const updated = await userService.getUser(user.id);
    assert.deepEqual(updated.preferences, {});
  });
});

test('acceptInvitationFor only touches invitations for the given email, not others', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const other = await service.createInvitation({ email: 'someone-else@example.com', invitedBy: adminId });
    const invitee = await userService.createUser({ email: 'invitee2@example.com' });
    await service.createInvitation({ email: 'invitee2@example.com', invitedBy: adminId });

    await service.acceptInvitationFor('invitee2@example.com', invitee.id);

    const [untouched] = (await service.listInvitations()).filter((i) => i.id === other.id);
    assert.equal(untouched.status, 'pending');
  });
});

test('acceptInvitationFor called twice for the same email only accepts once and does not error', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const inviteeEmail = 'twice@example.com';
    await service.createInvitation({ email: inviteeEmail, invitedBy: adminId });
    const invitee = await userService.createUser({ email: inviteeEmail });

    await service.acceptInvitationFor(inviteeEmail, invitee.id);
    await assert.doesNotReject(() => service.acceptInvitationFor(inviteeEmail, invitee.id));

    const matching = (await service.listInvitations()).filter((i) => i.email === inviteeEmail);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].status, 'accepted');
  });
});

test('expirePendingInvitations marks only pending invitations older than the threshold', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const old = await service.createInvitation({ email: 'old@example.com', invitedBy: adminId });
    const recent = await service.createInvitation({ email: 'recent@example.com', invitedBy: adminId });
    await client.query(`UPDATE invitations SET created_at = now() - interval '40 days' WHERE id = $1`, [old.id]);

    const expired = await service.expirePendingInvitations(30);

    assert.equal(expired.length, 1);
    assert.equal(expired[0].id, old.id);
    const all = await service.listInvitations();
    assert.equal(all.find((i) => i.id === old.id)?.status, 'expired');
    assert.equal(all.find((i) => i.id === recent.id)?.status, 'pending');
  });
});

test('expirePendingInvitations leaves already-accepted invitations untouched regardless of age', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const inviteeEmail = 'already-accepted@example.com';
    const invitation = await service.createInvitation({ email: inviteeEmail, invitedBy: adminId });
    const invitee = await userService.createUser({ email: inviteeEmail });
    await service.acceptInvitationFor(inviteeEmail, invitee.id);
    await client.query(`UPDATE invitations SET created_at = now() - interval '40 days' WHERE id = $1`, [invitation.id]);

    const expired = await service.expirePendingInvitations(30);

    assert.equal(expired.length, 0);
    const all = await service.listInvitations();
    assert.equal(all.find((i) => i.id === invitation.id)?.status, 'accepted');
  });
});

test('expirePendingInvitations is idempotent — a second call matches nothing more', async () => {
  await withTestTransaction(async (client) => {
    const { userId: adminId } = await seedWorkspace(client);
    const userService = new UserService(client);
    const service = new InvitationService(client, userService);
    const old = await service.createInvitation({ email: 'idempotent@example.com', invitedBy: adminId });
    await client.query(`UPDATE invitations SET created_at = now() - interval '40 days' WHERE id = $1`, [old.id]);

    const first = await service.expirePendingInvitations(30);
    const second = await service.expirePendingInvitations(30);

    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
  });
});
