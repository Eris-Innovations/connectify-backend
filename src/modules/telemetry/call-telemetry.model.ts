import { InferSchemaType, Schema, model } from 'mongoose';

const callTelemetrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    callId: { type: String, default: '', index: true },
    event: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    platform: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    clientTs: { type: Date },
  },
  { timestamps: true }
);

callTelemetrySchema.index({ createdAt: -1 });
callTelemetrySchema.index({ event: 1, createdAt: -1 });

export type CallTelemetryDocument = InferSchemaType<typeof callTelemetrySchema> & { _id: string };
export const CallTelemetryModel = model('CallTelemetryEvent', callTelemetrySchema);
