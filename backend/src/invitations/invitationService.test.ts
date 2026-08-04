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
