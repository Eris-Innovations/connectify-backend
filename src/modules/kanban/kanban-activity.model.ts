import { InferSchemaType, Schema, model } from 'mongoose';

const kanbanActivitySchema = new Schema(
  {
    boardId: { type: Schema.Types.ObjectId, ref: 'KanbanBoard', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['card_created', 'card_moved', 'card_updated', 'card_deleted', 'column_created', 'column_deleted'],
      required: true
    },
    meta: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

kanbanActivitySchema.index({ boardId: 1, createdAt: -1 });

export type KanbanActivityDocument = InferSchemaType<typeof kanbanActivitySchema> & { _id: string };
export const KanbanActivityModel = model('KanbanActivity', kanbanActivitySchema);
