import type { Env, TelemetryQueueMessage } from "./env";
import { processTelemetryMessage } from "./services/telemetry";
import { DLQ_QUEUE, recordDeadLetter } from "./services/dlq";
import { logError } from "./lib/logger";
import { flushLogs } from "./services/observability";

async function handleTelemetryBatch(
  batch: MessageBatch<TelemetryQueueMessage | unknown>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body as TelemetryQueueMessage | undefined;
    if (!body || typeof body.id !== "string" || typeof body.installationId !== "string") {
      logError("queue.invalid_message", new Error("invalid queue payload"));
      message.ack();
      continue;
    }
    try {
      await processTelemetryMessage(env, body);
      message.ack();
    } catch (error) {
      logError("queue.processing_failed", error, {
        eventId: body.id,
        installationId: body.installationId,
      });
      message.retry();
    }
  }
}

async function handleDeadLetterBatch(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await recordDeadLetter(env, batch.queue, message);
      message.ack();
    } catch (error) {
      // max_retries is 1 for the DLQ consumer: one bounded retry so a transient D1
      // failure does not drop the only copy of a poison message, then give up.
      logError("queue.dlq_persist_failed", error, { messageId: message.id });
      message.retry();
    }
  }
}

export async function handleQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  if (batch.queue === DLQ_QUEUE) {
    await handleDeadLetterBatch(batch, env);
  } else {
    await handleTelemetryBatch(batch, env);
  }
  // The consumer has no waitUntil: await the flush so the batch's warnings reach the sink.
  await flushLogs(env);
}
