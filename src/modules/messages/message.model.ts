import { InferSchemaType, Schema, model } from 'mongoose';

const replySnapshotSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    previewText: { type: String, default: '' },
    mediaType: { type: String, enum: ['text', 'image', 'video', 'file', 'voice'] }
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    content: {
      text: { type: String, default: '' },
      mediaUrl: { type: String },
      mediaType: {
        type: String,
        enum: ['text', 'image', 'video', 'file', 'voice', 'system'],
        default: 'text'
      },
      metadata: { type: Schema.Types.Mixed }
    },
    type: {
      type: String,
      enum: ['message', 'system'],
      default: 'message',
      index: true
    },
    /** Client-generated idempotency key for reconnect/retry-safe sends. */
    clientId: { type: String, trim: true, maxlength: 120 },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isSecret: { type: Boolean, default: false, index: true },
    isEncrypted: { type: Boolean, default: false },
    replyTo: { type: replySnapshotSchema },
    expiresAt: { type: Date },
    deletedForUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deletedForEveryoneAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedReplacementText: { type: String, default: '' }
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

// Conversation timeline queries
messageSchema.index({ conversationId: 1, createdAt: -1 });
// Sender history queries
messageSchema.index({ senderId: 1, createdAt: -1 });
// Idempotent client sends (sparse so system messages without clientId are allowed)
messageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $gt: '' } } }
);
// TTL for secret / ephemeral messages
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MessageDocument = InferSchemaType<typeof messageSchema> & { _id: string };
export const MessageModel = model('Message', messageSchema);
