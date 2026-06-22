import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { events, notifications, type EventRow } from "@/db/schema";
import { notifyAll, type Notifier, type NotifyMessage, type NotifyResult } from "@/notify/notifier";

/** Append a new domain event to the outbox (status "new"). */
export function emit(
  db: DB,
  type: string,
  payload: unknown,
  opts: { now?: () => string } = {},
): EventRow {
  const now = opts.now ?? (() => new Date().toISOString());
  const row: EventRow = {
    id: randomUUID(),
    type,
    payload,
    status: "new",
    createdAt: now(),
    processedAt: null,
  };
  db.insert(events).values(row).run();
  return row;
}

/**
 * Fan a message out to all configured notifiers and record one
 * `notifications` row per delivery attempt (audit trail + retry bookkeeping).
 */
export async function notify(
  db: DB,
  notifiers: Notifier[],
  message: NotifyMessage,
  opts: { eventId?: string | null; now?: () => string } = {},
): Promise<NotifyResult[]> {
  const now = opts.now ?? (() => new Date().toISOString());
  const results = await notifyAll(notifiers, message);

  for (const r of results) {
    db.insert(notifications)
      .values({
        id: randomUUID(),
        channel: r.notifier,
        eventId: opts.eventId ?? null,
        title: message.title,
        body: message.body,
        status: r.ok ? "sent" : "failed",
        attempts: 1,
        sentAt: r.ok ? now() : null,
        error: r.error ?? null,
        createdAt: now(),
      })
      .run();
  }

  return results;
}

/** Builds the notification for an event, or null if the event needs no notification. */
export type EventHandler = (
  event: EventRow,
) => NotifyMessage | null | Promise<NotifyMessage | null>;

export type EventHandlers = Record<string, EventHandler>;

export type ProcessEventsResult = {
  processed: number;
  failed: number;
  notified: number;
};

/**
 * Drain "new" events from the outbox: run each event's handler (by type),
 * notify on the resulting message (if any), and mark the event processed.
 * A throwing handler marks only that event "failed" — it does not block
 * the rest of the batch.
 */
export async function processEvents(
  db: DB,
  handlers: EventHandlers,
  notifiers: Notifier[],
  opts: { now?: () => string } = {},
): Promise<ProcessEventsResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const pending = db.select().from(events).where(eq(events.status, "new")).all();

  const result: ProcessEventsResult = { processed: 0, failed: 0, notified: 0 };

  for (const event of pending) {
    const handler = handlers[event.type];

    try {
      const message = handler ? await handler(event) : null;

      if (message) {
        const sent = await notify(db, notifiers, message, { eventId: event.id, now });
        result.notified += sent.length;
      }

      db.update(events)
        .set({ status: "processed", processedAt: now() })
        .where(eq(events.id, event.id))
        .run();
      result.processed++;
    } catch {
      db.update(events)
        .set({ status: "failed", processedAt: now() })
        .where(eq(events.id, event.id))
        .run();
      result.failed++;
    }
  }

  return result;
}
