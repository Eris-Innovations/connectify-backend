import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  updateMany: vi.fn(),
  deleteOne: vi.fn(),
  deleteTokens: vi.fn(),
  deletePushTokens: vi.fn(),
}));

vi.mock('../src/modules/users/user.model', () => ({
  UserModel: {
    findById: mocks.findById,
    updateMany: mocks.updateMany,
    deleteOne: mocks.deleteOne,
  },
}));

vi.mock('../src/modules/auth/refresh-token.model', () => ({
  RefreshTokenModel: { deleteMany: mocks.deleteTokens },
}));

vi.mock('../src/modules/users/device-push-token.model', () => ({
  DevicePushTokenModel: { deleteMany: mocks.deletePushTokens },
}));

import { AccountDeleteError, deleteOwnAccount } from '../src/modules/users/delete-account.service';

describe('deleteOwnAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ role: 'user' }) }),
    });
    mocks.updateMany.mockResolvedValue({});
    mocks.deleteOne.mockResolvedValue({});
    mocks.deleteTokens.mockResolvedValue({});
    mocks.deletePushTokens.mockResolvedValue({});
  });

  it('deletes the user, sessions, and push tokens', async () => {
    await deleteOwnAccount('user-1');
    expect(mocks.deleteTokens).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(mocks.deletePushTokens).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: 'user-1' });
  });

  it('rejects a missing user', async () => {
    mocks.findById.mockReturnValue({ select: () => ({ lean: async () => null }) });
    await expect(deleteOwnAccount('missing')).rejects.toBeInstanceOf(AccountDeleteError);
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });

  it('rejects an admin account', async () => {
    mocks.findById.mockReturnValue({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
    await expect(deleteOwnAccount('admin-1')).rejects.toMatchObject({ status: 403 });
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });
});
