export type NotifyPriority = "low" | "default" | "high" | "max";

export type NotifyMessage = {
  title: string;
  body: string;
  url?: string;
  priority?: NotifyPriority;
};

export type NotifyResult = { notifier: string; ok: boolean; error?: string };

export interface Notifier {
  name: string;
  configured: boolean;
  send(message: NotifyMessage): Promise<void>;
}

export async function notifyAll(
  notifiers: Notifier[],
  message: NotifyMessage,
): Promise<NotifyResult[]> {
  const configured = notifiers.filter((n) => n.configured);
  return Promise.all(
    configured.map(async (n) => {
      try {
        await n.send(message);
        return { notifier: n.name, ok: true };
      } catch (err) {
        return {
          notifier: n.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
