import { InferSchemaType, Schema, model } from 'mongoose';

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: () => new Date() },
    role: {
      type: String,
      enum: ['member', 'admin', 'owner'],
      default: 'member'
    },
    lastReadAt: { type: Date },
    deletedAt: { type: Date }
  },
  { _id: false }
);

const lastMessageSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    previewText: { type: String, default: '' },
    createdAt: { type: Date }
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['dm', 'group', 'channel'],
      required: true,
      index: true
    },
    participants: {
      type: [participantSchema],
      validate: {
        validator: (value: unknown[]) => Array.isArray(value) && value.length >= 1,
        message: 'Conversation must have at least one participant'
      }
    },
    title: { type: String },
    description: { type: String, default: '' },
    avatar: { type: String },
    lastMessage: { type: lastMessageSchema },
    lastActivityAt: { type: Date, default: () => new Date(), index: true },
    isSecret: { type: Boolean, default: false, index: true },
    secretExpiresAt: { type: Date },
    isArchived: { type: Boolean, default: false, index: true },
    isPinned: { type: Boolean, default: false },
    disappearingMessagesSeconds: {
      type: Number,
      enum: [0, 3600, 7200, 86400, 604800],
      default: 0
    },
    disappearingMessagesUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    disappearingMessagesUpdatedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

// Find all conversations a user participates in
conversationSchema.index({ 'participants.userId': 1, lastActivityAt: -1 });
// DMs uniqueness (two participants, dm type)
conversationSchema.index(
  { type: 1, 'participants.userId': 1 },
  { partialFilterExpression: { type: 'dm' } }
);

export type ConversationDocument = InferSchemaType<typeof conversationSchema> & { _id: string };
export const ConversationModel = model('Conversation', conversationSchema);
