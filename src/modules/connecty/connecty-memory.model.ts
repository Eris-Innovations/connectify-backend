import { type Document, Schema, Types, model } from 'mongoose';

export const CONNECTY_FACT_CATEGORIES = [
  'identity',
  'preference',
  'relationship',
  'goal',
  'event',
  'emotion',
  'other'
] as const;

export type ConnectyFactCategory = (typeof CONNECTY_FACT_CATEGORIES)[number];

const connectyMemoryFactSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: {
      type: String,
      enum: CONNECTY_FACT_CATEGORIES,
      default: 'other'
    },
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
    evidence: { type: String, default: null },
    importance: { type: Number, min: 1, max: 5, default: 3 },
    confidence: { type: Number, min: 0, max: 1, default: 0.8 },
    lastReinforcedAt: { type: Date, default: Date.now },
    sourceMessageId: { type: Schema.Types.ObjectId, ref: 'ConnectyMessage', default: null }
  },
  { timestamps: true }
);

connectyMemoryFactSchema.index({ userId: 1, key: 1 }, { unique: true });
connectyMemoryFactSchema.index({ userId: 1, importance: -1, lastReinforcedAt: -1 });

export interface ConnectyMemoryFactDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  category: ConnectyFactCategory;
  key: string;
  value: string;
  evidence?: string | null;
  importance: number;
  confidence: number;
  lastReinforcedAt: Date;
  sourceMessageId?: Types.ObjectId | null;
}

export const ConnectyMemoryFactModel = model<ConnectyMemoryFactDocument>(
  'ConnectyMemoryFact',
  connectyMemoryFactSchema
);
