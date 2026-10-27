import { z } from "zod";
export const telegramOptionsSchema = z.object({
  image: z.string().nullable().optional(),
  url: z.string().optional(),
  buttons: z
    .array(
      z
        .array(
          z.object({
            text: z.string().min(1).max(64),
            data: z.string().min(1).max(64),
          }),
        )
        .max(8),
    )
    .max(30)
    .optional(),
  keyboard: z
    .array(z.array(z.string().min(1).max(64)).max(4))
    .max(4)
    .optional(),
});
export type TelegramOptions = z.infer<typeof telegramOptionsSchema>;
export type TelegramSend = (
  text: string,
  options?: TelegramOptions,
) => Promise<void>;
