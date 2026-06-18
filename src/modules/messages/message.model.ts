import { InferSchemaType, Schema, model } from 'mongoose';

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
    deliveredAt: { type: Date },
    readAt: { type: Date },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isSecret: { type: Boolean, default: false, index: true },
    isEncrypted: { type: Boolean, default: false },
    expiresAt: { type: Date }
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

// Conversation timeline queries
messageSchema.index({ conversationId: 1, createdAt: -1 });
// Sender history queries
messageSchema.index({ senderId: 1, createdAt: -1 });
// TTL for secret / ephemeral messages
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MessageDocument = InferSchemaType<typeof messageSchema> & { _id: string };
export const MessageModel = model('Message', messageSchema);

