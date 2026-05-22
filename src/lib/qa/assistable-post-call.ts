import { z } from 'zod';

export const assistablePostCallPayloadSchema = z
  .object({
    call_id: z.string().trim().min(1),
    call_type: z.string().optional(),
    direction: z.enum(['inbound', 'outbound']).optional(),
    to: z.string().optional(),
    from: z.string().optional(),
    contact_id: z.string().optional(),
    location_id: z.string().optional(),
    disconnection_reason: z.string().optional(),
    user_sentiment: z.string().optional(),
    call_summary: z.string().optional(),
    call_completion: z.string().optional(),
    assistant_task_completion: z.string().optional(),
    recording_url: z.string().optional(),
    call_time_ms: z.number().optional(),
    call_time_seconds: z.number().optional(),
    full_transcript: z.string().optional(),
    start_timestamp: z.string().optional(),
    end_timestamp: z.string().optional(),
    tags: z.array(z.string()).optional(),
    contact_tags: z.array(z.string()).optional(),
    ghl_tags: z.array(z.string()).optional(),
  })
  .passthrough();

export type AssistablePostCallPayload = z.infer<typeof assistablePostCallPayloadSchema>;

export function normalizeAssistablePostCallPayload(body: unknown): AssistablePostCallPayload {
  return assistablePostCallPayloadSchema.parse(body);
}

export function resolveCallType(
  payload: AssistablePostCallPayload,
): 'inbound' | 'outbound' | undefined {
  if (payload.direction) {
    return payload.direction;
  }

  const normalized = payload.call_type?.trim().toLowerCase();
  if (normalized === 'inbound' || normalized === 'outbound') {
    return normalized;
  }

  return undefined;
}
