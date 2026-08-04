import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LogFields, Logger } from '../logging/types';
import type { Invitation } from '../invitations/types';
import { WebhookNotificationService } from './webhookNotificationService';

class RecordingLogger implements Logger {
  warnCalls: Array<{ message: string; fields?: LogFields }> = [];

  debug(): void {}
  info(): void {}
  warn(message: string, fields?: LogFields): void {
    this.warnCalls.push({ message, fields });
  }
  error(): void {}
}

const SAMPLE_INVITATION: Invitation = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'prospect@example.com',
  invitedBy: '22222222-2222-2222-2222-222222222222',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('notifyInvitationCreated POSTs the invitation payload to the webhook URL', async () => {
  let receivedBody = '';
  let receivedContentType: string | undefined;

  await withServer(
    (req, res) => {
      receivedContentType = req.headers['content-type'];
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        receivedBody = raw;
        res.writeHead(200);
        res.end();
      });
    },
    async (url) => {
      const logger = new RecordingLogger();
      const service = new WebhookNotificationService(url, logger);

      await service.notifyInvitationCreated(SAMPLE_INVITATION);

      assert.equal(receivedContentType, 'application/json');
      const parsed = JSON.parse(receivedBody) as { event: string; invitation: Invitation };
      assert.equal(parsed.event, 'invitation.created');
      assert.deepEqual(parsed.invitation, SAMPLE_INVITATION);
      assert.equal(logger.warnCalls.length, 0);
    },
  );
});

test('notifyInvitationCreated logs a warning and never throws when the webhook responds non-2xx', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(500);
      res.end();
    },
    async (url) => {
      const logger = new RecordingLogger();
      const service = new WebhookNotificationService(url, logger);

      await assert.doesNotReject(() => service.notifyInvitationCreated(SAMPLE_INVITATION));

      assert.equal(logger.warnCalls.length, 1);
      assert.match(logger.warnCalls[0].message, /non-2xx/);
    },
  );
});

test('notifyInvitationCreated logs a warning and never throws when the webhook is unreachable', async () => {
  // Port 0 with no listening server: nothing is bound here, so the connection is refused.
  const unreachableUrl = 'http://127.0.0.1:1';
  const logger = new RecordingLogger();
  const service = new WebhookNotificationService(unreachableUrl, logger);

  await assert.doesNotReject(() => service.notifyInvitationCreated(SAMPLE_INVITATION));

  assert.equal(logger.warnCalls.length, 1);
  assert.match(logger.warnCalls[0].message, /failed/);
});
