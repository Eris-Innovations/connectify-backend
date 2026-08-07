import { type Document, Schema, Types, model } from 'mongoose';

const connectyMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    threadId: { type: Schema.Types.ObjectId, ref: 'ConnectyThread', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, required: true },
    emotion: { type: String, default: null },
    /** Client-generated id for send idempotency (double-tap / flaky network). */
    clientId: { type: String, default: null, trim: true },
    /** Links assistant reply to the user turn that triggered it (for idempotent lookups). */
    replyToMessageId: { type: Schema.Types.ObjectId, ref: 'ConnectyMessage', default: null }
  },
  { timestamps: true }
);

connectyMessageSchema.index({ userId: 1, createdAt: -1 });
connectyMessageSchema.index({ threadId: 1, createdAt: 1 });
connectyMessageSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

export interface ConnectyMessageDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  role: 'user' | 'assistant' | 'system';
  text: string;
  emotion?: string | null;
  clientId?: string | null;
  replyToMessageId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ConnectyMessageModel = model<ConnectyMessageDocument>('ConnectyMessage', connectyMessageSchema);
