import { InferSchemaType, Schema, model } from 'mongoose';

const dsarRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    exportUrl: { type: String, default: '' },
    encryptedArchiveName: { type: String, default: '' },
    requestedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

export type DsarRequestDocument = InferSchemaType<typeof dsarRequestSchema> & { _id: string };
export const DsarRequestModel = model('DsarRequest', dsarRequestSchema);

