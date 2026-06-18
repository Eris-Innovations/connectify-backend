import { InferSchemaType, Schema, model } from 'mongoose';

const consentRecordSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, required: true, index: true },
    policyVersion: { type: String, required: true },
    acceptedAt: { type: Date, default: Date.now, index: true },
    ipAddress: { type: String, default: '' }
  },
  { timestamps: true }
);

export type ConsentRecordDocument = InferSchemaType<typeof consentRecordSchema> & { _id: string };
export const ConsentRecordModel = model('ConsentRecord', consentRecordSchema);

