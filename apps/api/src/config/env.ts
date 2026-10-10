import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const isProd = process.env.NODE_ENV === 'production';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    WEB_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    APP_URL: z.string().url().optional(),
    COOKIE_SECURE: bool(isProd),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(48),
    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(25).default(5),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default(isProd ? 'info' : 'debug'),
    EMAIL_PROVIDER: z.enum(['none', 'console', 'smtp']).default('none'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    RATE_LIMIT_DISABLED: bool(false),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'smtp' && (!env.SMTP_HOST || !env.EMAIL_FROM)) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST and EMAIL_FROM are required when EMAIL_PROVIDER=smtp' });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'The console email provider is for development only' });
    }
    if (env.NODE_ENV === 'production' && env.RATE_LIMIT_DISABLED) {
      ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_DISABLED'], message: 'Rate limiting cannot be disabled in production' });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Cookies must be Secure in production' });
    }
  });

export type Env = z.infer<typeof schema> & { APP_URL: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const data = parsed.data;
  return { ...data, APP_URL: data.APP_URL ?? data.WEB_ORIGIN[0] ?? 'http://localhost:5173' };
}
