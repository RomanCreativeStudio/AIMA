import type { CalendarConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `update_calendar_event` (Tier 3, tier-locked, new in Phase 2.7). */
export class CalendarUpdateEventExecutor implements ActionExecutor {
  readonly actionType = 'update_calendar_event';
  readonly provider = 'calendar' as const;

  constructor(private readonly connector: CalendarConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { eventId, title, startsAt, endsAt, description, calendarId } = context.payload;
    if (typeof eventId !== 'string') {
      throw new Error('payload.eventId is required');
    }
    for (const [key, value] of Object.entries({ title, startsAt, endsAt, description, calendarId })) {
      if (value !== undefined && typeof value !== 'string') {
        throw new Error(`payload.${key} must be a string if provided`);
      }
    }
    if (title === undefined && startsAt === undefined && endsAt === undefined && description === undefined) {
      throw new Error('at least one of payload.title, payload.startsAt, payload.endsAt, or payload.description must be provided');
    }

    const result = await this.connector.updateEvent(context.credentials, eventId, {
      title: title as string | undefined,
      startsAt: startsAt as string | undefined,
      endsAt: endsAt as string | undefined,
      description: description as string | undefined,
      calendarId: calendarId as string | undefined,
    });
    return { responseSummary: { eventId: result.eventId } };
  }
}
