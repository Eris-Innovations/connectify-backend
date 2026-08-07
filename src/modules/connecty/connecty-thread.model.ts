import { type Document, Schema, Types, model } from 'mongoose';

const connectyThreadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    runningSummary: { type: String, default: '' },
    summaryUpToMessageId: { type: Schema.Types.ObjectId, ref: 'ConnectyMessage', default: null },
    topicTags: { type: [String], default: [] },
    lastEmotion: { type: String, default: null },
    messageCount: { type: Number, default: 0 },
    lastMessagePreview: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export interface ConnectyThreadDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  runningSummary: string;
  summaryUpToMessageId?: Types.ObjectId | null;
  topicTags: string[];
  lastEmotion?: string | null;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageAt?: Date | null;
}

export const ConnectyThreadModel = model<ConnectyThreadDocument>('ConnectyThread', connectyThreadSchema);
