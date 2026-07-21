import { InferSchemaType, Schema, model } from 'mongoose';

const callSchema = new Schema(
  {
    callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['incoming', 'outgoing', 'missed'], required: true },
    isVideo: { type: Boolean, default: false },
    duration: { type: Number, default: 0 },
    /** R2 URL or key when a call recording was uploaded for transcription. */
    recordingUrl: { type: String, default: '' },
    /** User who uploaded the recording (caller or receiver). */
    recordingUploadedBy: { type: Schema.Types.ObjectId, ref: 'User', sparse: true }
  },
  { timestamps: true }
);

callSchema.index({ callerId: 1, receiverId: 1, createdAt: -1 });

export type CallDocument = InferSchemaType<typeof callSchema> & { _id: string };
export const CallModel = model('Call', callSchema);
