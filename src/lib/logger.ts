import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const logtailToken = process.env.LOGTAIL_SOURCE_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level,
  ...(isProduction
    ? logtailToken
      ? {
          transport: {
            target: '@logtail/pino',
            options: { sourceToken: logtailToken },
          },
        }
      : {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }),
});

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}