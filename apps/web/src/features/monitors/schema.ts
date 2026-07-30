import { z } from "zod"

export const monitorScheduleSchema = z.object({
  type: z.enum(["MANUAL", "INTERVAL", "CRON"]),
  expression: z.string().optional(),
  intervalSeconds: z.number().int().min(10).optional(),
  timezone: z.string().min(1),
  jitterSeconds: z.number().int().min(0).max(3600),
  concurrencyPolicy: z.enum(["SKIP_IF_RUNNING", "QUEUE", "ALLOW"]),
  missedRunPolicy: z.enum(["SKIP", "RUN_ONCE"]),
})

export const createMonitorSchema = z.object({
  creationId: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Enter a monitor name.")
    .max(255, "Use 255 characters or fewer."),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a slug.")
    .max(255, "Use 255 characters or fewer.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and single hyphens."
    ),
  description: z.string().trim().max(2000, "Use 2,000 characters or fewer."),
  ownerId: z.string().trim().max(255, "Use 255 characters or fewer."),
  environmentId: z.string().trim().optional(),
  tags: z
    .array(z.string().trim().min(1).max(64))
    .max(20, "Use no more than 20 tags."),
  definition: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean(),
  schedule: monitorScheduleSchema,
})

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>
