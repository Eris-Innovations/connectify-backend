import { InferSchemaType, Schema, model } from 'mongoose';

const kanbanBoardSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, unique: true },
    name: { type: String, default: 'Board' }
  },
  { timestamps: true }
);

export type KanbanBoardDocument = InferSchemaType<typeof kanbanBoardSchema> & { _id: string };
export const KanbanBoardModel = model('KanbanBoard', kanbanBoardSchema);
