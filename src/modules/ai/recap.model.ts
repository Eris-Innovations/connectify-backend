import { InferSchemaType, Schema, model } from 'mongoose';

const actionItemSchema = new Schema(
  {
    task: { type: String, required: true },
    assignee: { type: String },
    dueDate: { type: String },
    done: { type: Boolean, default: false }
  },
  { _id: false }
);

const recapSchema = new Schema(
  {
    callSessionId: { type: Schema.Types.ObjectId, ref: 'Call', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    summary: { type: String, required: true },
    actionItems: [actionItemSchema],
    keyDecisions: [{ type: String }],
    editedSummary: { type: String },
    editedAt: { type: Date },
    optOut: { type: Boolean, default: false }
  },
  {
    timestamps: true
  }
);

export type RecapDocument = InferSchemaType<typeof recapSchema> & { _id: string };
export const RecapModel = model('Recap', recapSchema);

