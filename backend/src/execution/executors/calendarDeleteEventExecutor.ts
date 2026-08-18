import type { CalendarConnector } from '../../integrations/connectors/types';
import type { ActionExecutor, ExecutionOutcome, ExecutorContext } from '../types';

/** `delete_calendar_event` (Tier 3, tier-locked, new in Phase 2.7). */
export class CalendarDeleteEventExecutor implements ActionExecutor {
  readonly actionType = 'delete_calendar_event';
  readonly provider = 'calendar' as const;

  constructor(private readonly connector: CalendarConnector) {}

  async execute(context: ExecutorContext): Promise<ExecutionOutcome> {
    const { eventId, calendarId } = context.payload;
    if (typeof eventId !== 'string') {
      throw new Error('payload.eventId is required');
    }
    if (calendarId !== undefined && typeof calendarId !== 'string') {
      throw new Error('payload.calendarId must be a string if provided');
    }

    await this.connector.deleteEvent(context.credentials, eventId, { calendarId: typeof calendarId === 'string' ? calendarId : undefined });
    return { responseSummary: { eventId, deleted: true } };
  }
}
