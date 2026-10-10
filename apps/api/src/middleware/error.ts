import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';
import { runtime } from '../services/runtime.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

/** Central error mapping. Clients never receive stack traces or internal messages. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files' : 'Upload rejected';
    res.status(400).json({ error: { code: 'upload_rejected', message } });
    return;
  }
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Request body is not valid JSON' } });
    return;
  }
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large' } });
    return;
  }
  if (err instanceof mongoose.Error.CastError || err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ error: { code: 'bad_request', message: 'Invalid data' } });
    return;
  }
  if (isDuplicateKeyError(err)) {
    res.status(409).json({ error: { code: 'duplicate', message: 'That record already exists' } });
    return;
  }
  runtime().logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
}
