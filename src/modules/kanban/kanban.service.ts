import { Types } from 'mongoose';
import { ChannelModel } from '../channels/channel.model';
import { KanbanBoardModel } from './kanban-board.model';
import { KanbanColumnModel } from './kanban-column.model';
import { KanbanCardModel } from './kanban-card.model';
import { KanbanActivityModel } from './kanban-activity.model';

export function isChannelMember(channel: { ownerId: unknown; members: unknown[] }, userId: string): boolean {
  const uid = String(userId);
  if (String(channel.ownerId) === uid) return true;
  return (channel.members ?? []).some((m) => String(m) === uid);
}

export async function assertChannelMember(channelId: string, userId: string) {
  if (!Types.ObjectId.isValid(channelId)) return null;
  const channel = await ChannelModel.findById(channelId).lean();
  if (!channel || !isChannelMember(channel, userId)) return null;
  return channel;
}

export async function ensureBoardWithDefaults(channelId: string) {
  let board = await KanbanBoardModel.findOne({ channelId: new Types.ObjectId(channelId) });
  if (!board) {
    board = await KanbanBoardModel.create({
      channelId: new Types.ObjectId(channelId),
      name: 'Board'
    });
    const titles = ['To do', 'Doing', 'Done'];
    await KanbanColumnModel.insertMany(
      titles.map((title, position) => ({
        boardId: board!._id,
        title,
        position
      }))
    );
  }
  return board;
}

export async function getBoardTree(boardId: Types.ObjectId) {
  const columns = await KanbanColumnModel.find({ boardId }).sort({ position: 1 }).lean();
  const columnIds = columns.map((c) => c._id);
  const cards = await KanbanCardModel.find({ columnId: { $in: columnIds } }).sort({ position: 1 }).lean();
  const byColumn = new Map<string, typeof cards>();
  for (const c of cards) {
    const key = String(c.columnId);
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key)!.push(c);
  }
  return {
    columns: columns.map((col) => ({
      id: String(col._id),
      title: col.title,
      position: col.position,
      createdAt: col.createdAt,
      cards: (byColumn.get(String(col._id)) ?? []).map((card) => ({
        id: String(card._id),
        title: card.title,
        description: card.description,
        position: card.position,
        createdBy: String(card.createdBy),
        createdAt: card.createdAt
      }))
    }))
  };
}

export async function logKanbanActivity(input: {
  boardId: Types.ObjectId;
  actorId: string;
  type: 'card_created' | 'card_moved' | 'card_updated' | 'card_deleted' | 'column_created' | 'column_deleted';
  meta?: Record<string, unknown>;
}) {
  await KanbanActivityModel.create({
    boardId: input.boardId,
    actorId: new Types.ObjectId(input.actorId),
    type: input.type,
    meta: input.meta ?? {}
  });
}

export async function nextCardPosition(columnId: Types.ObjectId) {
  const last = await KanbanCardModel.findOne({ columnId }).sort({ position: -1 }).lean();
  return (last?.position ?? -1) + 1;
}
