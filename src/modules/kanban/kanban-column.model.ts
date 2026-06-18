import { InferSchemaType, Schema, model } from 'mongoose';

const kanbanColumnSchema = new Schema(
  {
    boardId: { type: Schema.Types.ObjectId, ref: 'KanbanBoard', required: true, index: true },
    title: { type: String, required: true, trim: true },
    position: { type: Number, required: true }
  },
  { timestamps: true }
);

kanbanColumnSchema.index({ boardId: 1, position: 1 });

export type KanbanColumnDocument = InferSchemaType<typeof kanbanColumnSchema> & { _id: string };
export const KanbanColumnModel = model('KanbanColumn', kanbanColumnSchema);
