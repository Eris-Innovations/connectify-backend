import crypto from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { MongoServerError } from 'mongodb';

export type ErrorFields = Record<string, string[]>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
    public readonly fields?: ErrorFields
  ) {
    super(message);
  }
}

export const requestContext: RequestHandler = (_req, res, next) => {
  res.locals.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId);
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && (body as { success?: unknown }).success === false) {
      const failure = body as Record<string, unknown>;
      return sendJson({
        ...failure,
        errorCode: typeof failure.errorCode === 'string' ? failure.errorCode : `HTTP_${res.statusCode}`,
        requestId: typeof failure.requestId === 'string' ? failure.requestId : res.locals.requestId
      });
    }
    return sendJson(body);
  }) as Response['json'];
  next();
};

export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void handler(req as T, res, next).catch(next);
  };
}

function duplicateError(error: MongoServerError): ApiError {
  const key = Object.keys((error.keyPattern as Record<string, unknown> | undefined) ?? {})[0] ?? '';
  if (key === 'phone') return new ApiError(409, 'PHONE_ALREADY_REGISTERED', 'This phone number is already registered.');
  if (key === 'email') return new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
  if (key === 'username') return new ApiError(409, 'USERNAME_ALREADY_TAKEN', 'This username is already taken.');
  return new ApiError(409, 'DUPLICATE_RECORD', 'This record already exists.');
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;
  const requestId = String(res.locals.requestId ?? crypto.randomUUID());
  let apiError: ApiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof MongoServerError && error.code === 11000) {
    apiError = duplicateError(error);
  } else if (error?.name === 'MongoServerSelectionError' || error?.name === 'MongooseServerSelectionError') {
    apiError = new ApiError(503, 'DATABASE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again.');
  } else {
    apiError = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on the server. Please try again.');
  }

  if (apiError.status >= 500) {
    console.error('[http.error]', { requestId, error });
  }

  return res.status(apiError.status).json({
    success: false,
    message: apiError.message,
    errorCode: apiError.errorCode,
    ...(apiError.fields ? { fields: apiError.fields } : {}),
    requestId
  });
};
