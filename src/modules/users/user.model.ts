import { Schema, model, InferSchemaType } from 'mongoose';

const userSettingsSchema = new Schema(
  {
    privacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    readReceiptsEnabled: {
      type: Boolean,
      default: true
    },
    showLastSeen: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
      enum: ['system', 'light', 'dark'],
      default: 'system'
    }
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, sparse: true, unique: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    bio: { type: String, default: '' },
    avatar: { type: String, default: '' },
    hasCompletedProfile: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false, index: true },
    region: {
      type: String,
      enum: ['eu', 'apac', 'na'],
      default: 'na',
      index: true
    },
    creatorProfile: {
      isCreator: { type: Boolean, default: false },
      stripeConnectAccountId: { type: String, default: '' },
      payoutsEnabled: { type: Boolean, default: false },
      onboardingCompletedAt: { type: Date }
    },
    lastSeenAt: { type: Date },
    followers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    settings: { type: userSettingsSchema, default: () => ({}) },
    role: {
      type: String,
      enum: ['user', 'admin', 'super_admin', 'moderator', 'analyst'],
      default: 'user',
      index: true
    },
    adminScope: {
      type: String,
      enum: ['global', 'assigned'],
      default: 'global',
      index: true
    },
    createdBySuperAdminId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAdminId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignedBySuperAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },
    assignmentNote: { type: String, default: '' },
    expoPushTokens: { type: [String], default: [] }
  },
  {
    timestamps: true
  }
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: string };
export const UserModel = model('User', userSchema);
