import { InferSchemaType, Schema, model } from 'mongoose';

const segmentSchema = new Schema(
  {
    speakerId: { type: String },
    startTime: { type: Number }, // seconds
    endTime: { type: Number }, // seconds
    text: { type: String, required: true }
  },
  { _id: false }
);

const transcriptSchema = new Schema(
  {
    /** User whose audio this transcript describes (sender of voice message, etc.). */
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    kind: {
      type: String,
      enum: ['call', 'voice_message', 'audio'],
      default: 'call',
      index: true
    },
    callSessionId: { type: Schema.Types.ObjectId, ref: 'Call' },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', index: true, sparse: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    mediaUrl: { type: String },
    language: { type: String, default: 'en' },
    segments: [segmentSchema],
    rawText: { type: String, required: true },
    diarizationMeta: { type: Schema.Types.Mixed },
    source: { type: String, enum: ['device', 'whisper', 'server'], required: true },
    whisperModel: { type: String }
  },
  {
    timestamps: true
  }
);

transcriptSchema.index({ rawText: 'text' });
transcriptSchema.index({ messageId: 1 }, { unique: true, sparse: true });
transcriptSchema.index({ callSessionId: 1 }, { unique: true, sparse: true });
transcriptSchema.index({ userId: 1, createdAt: -1 });

export type TranscriptDocument = InferSchemaType<typeof transcriptSchema> & { _id: string };
export const TranscriptModel = model('Transcript', transcriptSchema);
