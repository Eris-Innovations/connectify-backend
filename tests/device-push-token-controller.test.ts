import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findOneAndUpdate: vi.fn(),
  deleteOne: vi.fn(),
}));

vi.mock('../src/modules/users/device-push-token.model', () => ({
  DevicePushTokenModel: {
    deleteMany: mocks.deleteMany,
    findOneAndUpdate: mocks.findOneAndUpdate,
    deleteOne: mocks.deleteOne,
    countDocuments: vi.fn(),
  },
}));
vi.mock('../src/modules/users/user.model', () => ({
  UserModel: {},
}));
vi.mock('../src/lib/r2', () => ({
  resolveStoredMediaUrl: vi.fn(),
}));
vi.mock('../src/sockets/io', () => ({
  isUserConnected: vi.fn(),
}));

import {
  deleteDevicePushTokenController,
  upsertDevicePushTokenController,
} from '../src/modules/users/users.controller';

function responseMock() {
  const res: any = {
    locals: { requestId: 'request-1' },
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('device push token ownership controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.findOneAndUpdate.mockReturnValue({
      lean: async () => ({ _id: 'device-row-1' }),
    });
  });

  it('detaches matching tokens from other accounts before registering this device', async () => {
    const req: any = {
      auth: { userId: 'user-1' },
      body: {
        deviceId: 'device-1',
        platform: 'android',
        expoToken: 'ExponentPushToken[token-1]',
        fcmToken: 'fcm-1',
      },
    };
    const res = responseMock();

    await upsertDevicePushTokenController(req, res);

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      userId: { $ne: 'user-1' },
      $or: [
        { expoToken: 'ExponentPushToken[token-1]' },
        { fcmToken: 'fcm-1' },
      ],
    });
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user-1', deviceId: 'device-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          platform: 'android',
          expoToken: 'ExponentPushToken[token-1]',
          fcmToken: 'fcm-1',
          enabled: true,
        }),
      }),
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('removes only the current account/device registration on logout', async () => {
    const req: any = {
      auth: { userId: 'user-1' },
      params: { deviceId: 'device-1' },
    };
    const res = responseMock();

    await deleteDevicePushTokenController(req, res);

    expect(mocks.deleteOne).toHaveBeenCalledWith({
      userId: 'user-1',
      deviceId: 'device-1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects registrations without a stable device and native/Expo token', async () => {
    const req: any = {
      auth: { userId: 'user-1' },
      body: { deviceId: '', platform: 'android' },
    };
    const res = responseMock();

    await upsertDevicePushTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
