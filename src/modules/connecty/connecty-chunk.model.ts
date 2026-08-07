import { type Document, Schema, Types, model } from 'mongoose';

const connectyMemoryChunkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    kind: { type: String, enum: ['fact', 'summary', 'turn'], default: 'turn' },
    sourceMessageIds: { type: [Schema.Types.ObjectId], default: [] }
  },
  { timestamps: true }
);

connectyMemoryChunkSchema.index({ userId: 1, createdAt: -1 });
connectyMemoryChunkSchema.index({ userId: 1, kind: 1 });

export interface ConnectyMemoryChunkDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  text: string;
  embedding: number[];
  kind: 'fact' | 'summary' | 'turn';
  sourceMessageIds: Types.ObjectId[];
  createdAt: Date;
}

export const ConnectyMemoryChunkModel = model<ConnectyMemoryChunkDocument>(
  'ConnectyMemoryChunk',
  connectyMemoryChunkSchema
);
