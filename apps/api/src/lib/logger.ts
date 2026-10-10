import pino from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    // Never log credentials, session material or visitor contact details.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.newPassword',
        '*.currentPassword',
        '*.token',
        '*.visitorPhone',
        '*.phone',
      ],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
