import { StatusCodes } from 'http-status-codes';
import { RefreshTokenModel } from '../auth/refresh-token.model';
import { DevicePushTokenModel } from './device-push-token.model';
import { UserModel } from './user.model';

export class AccountDeleteError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Permanently removes a member account so they cannot sign in again. */
export async function deleteOwnAccount(userId: string) {
  const user = await UserModel.findById(userId).select('role').lean();
  if (!user) {
    throw new AccountDeleteError('User not found', StatusCodes.NOT_FOUND);
  }
  if (user.role === 'admin' || user.role === 'super_admin') {
    throw new AccountDeleteError(
      'Admin accounts cannot be deleted from the app.',
      StatusCodes.FORBIDDEN
    );
  }

  await RefreshTokenModel.deleteMany({ userId });
  await DevicePushTokenModel.deleteMany({ userId });
  await UserModel.updateMany(
    { $or: [{ followers: userId }, { following: userId }] },
    { $pull: { followers: userId, following: userId } }
  );
  await UserModel.deleteOne({ _id: userId });
}
