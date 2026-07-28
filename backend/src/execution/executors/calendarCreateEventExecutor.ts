import type { CalendarConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `create_calendar_event` (Tier 3, tier-locked, new in Phase 2.7). */
export class CalendarCreateEventExecutor implements ActionExecutor {
  readonly actionType = 'create_calendar_event';
  readonly provider = 'calendar' as const;

  constructor(private readonly connector: CalendarConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { title, startsAt, endsAt, description, calendarId } = context.payload;
    if (typeof title !== 'string' || typeof startsAt !== 'string' || typeof endsAt !== 'string') {
      throw new Error('payload.title, payload.startsAt, and payload.endsAt are all required strings');
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new Error('payload.description must be a string if provided');
    }
    if (calendarId !== undefined && typeof calendarId !== 'string') {
      throw new Error('payload.calendarId must be a string if provided');
    }

    const result = await this.connector.createEvent(context.credentials, {
      title,
      startsAt,
      endsAt,
      description: typeof description === 'string' ? description : undefined,
      calendarId: typeof calendarId === 'string' ? calendarId : undefined,
    });
    return { responseSummary: { eventId: result.eventId, title, startsAt, endsAt } };
  }
}
