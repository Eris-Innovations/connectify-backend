import { StatusCodes } from 'http-status-codes';

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
};

export function ok<T>(data: T): { status: number; body: ApiResponse<T> } {
  return { status: StatusCodes.OK, body: { success: true, data } };
}

