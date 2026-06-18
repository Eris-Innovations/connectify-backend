import { type Document, Schema, Types, model } from 'mongoose';

const agentRunSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'awaiting_confirmation', 'cancelled'],
      default: 'active',
      index: true
    },
    /** Anthropic-shaped turns: { role, content } where content is string or content-block array */
    messages: { type: [Schema.Types.Mixed], default: [] }
  },
  { timestamps: true }
);

agentRunSchema.index({ userId: 1, updatedAt: -1 });

export interface AgentRunDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  status: 'active' | 'awaiting_confirmation' | 'cancelled';
  messages: unknown[];
}

export const AgentRunModel = model<AgentRunDocument>('AgentRun', agentRunSchema);
