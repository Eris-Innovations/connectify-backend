import { InferSchemaType, Schema, Types, model } from 'mongoose';

const liveLocationSessionSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    label: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: true },
    stoppedAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

liveLocationSessionSchema.index({ conversationId: 1, userId: 1, stoppedAt: 1 });
liveLocationSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LiveLocationSessionDocument = InferSchemaType<typeof liveLocationSessionSchema> & {
  _id: Types.ObjectId;
};

export const LiveLocationSessionModel = model('LiveLocationSession', liveLocationSessionSchema);
