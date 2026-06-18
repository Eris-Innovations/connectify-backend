import { InferSchemaType, Schema, model } from 'mongoose';

const kanbanCardSchema = new Schema(
  {
    columnId: { type: Schema.Types.ObjectId, ref: 'KanbanColumn', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    position: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

kanbanCardSchema.index({ columnId: 1, position: 1 });

export type KanbanCardDocument = InferSchemaType<typeof kanbanCardSchema> & { _id: string };
export const KanbanCardModel = model('KanbanCard', kanbanCardSchema);
