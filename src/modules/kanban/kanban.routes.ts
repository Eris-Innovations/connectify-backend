import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { KanbanBoardModel } from './kanban-board.model';
import { KanbanColumnModel } from './kanban-column.model';
import { KanbanCardModel } from './kanban-card.model';
import { KanbanActivityModel } from './kanban-activity.model';
import {
  assertChannelMember,
  ensureBoardWithDefaults,
  getBoardTree,
  logKanbanActivity,
  nextCardPosition
} from './kanban.service';

export const kanbanRouter = Router();

function singleParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return null;
}

kanbanRouter.get('/channels/:channelId/kanban', requireAuth, async (req: AuthedRequest, res) => {
  const channelId = singleParam(req.params.channelId);
  if (!channelId || !Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ success: false, message: 'Invalid channel id' });
  }
  const channel = await assertChannelMember(channelId, req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Join this channel to use the board' });
  }

  const board = await ensureBoardWithDefaults(channelId);
  const tree = await getBoardTree(board._id);

  return res.json({
    success: true,
    data: {
      board: { id: String(board._id), channelId: String(board.channelId), name: board.name, createdAt: board.createdAt },
      columns: tree.columns
    }
  });
});

kanbanRouter.get('/channels/:channelId/kanban/activity', requireAuth, async (req: AuthedRequest, res) => {
  const channelId = singleParam(req.params.channelId);
  if (!channelId || !Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ success: false, message: 'Invalid channel id' });
  }
  const channel = await assertChannelMember(channelId, req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Join this channel to view activity' });
  }

  const board = await KanbanBoardModel.findOne({ channelId: new Types.ObjectId(channelId) }).lean();
  if (!board) {
    return res.json({ success: true, data: [] });
  }

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
  const rows = await KanbanActivityModel.find({ boardId: board._id }).sort({ createdAt: -1 }).limit(limit).lean();

  return res.json({
    success: true,
    data: rows.map((r) => ({
      id: String(r._id),
      type: r.type,
      actorId: String(r.actorId),
      meta: r.meta ?? {},
      createdAt: r.createdAt
    }))
  });
});

kanbanRouter.post('/channels/:channelId/kanban/columns', requireAuth, async (req: AuthedRequest, res) => {
  const channelId = singleParam(req.params.channelId);
  if (!channelId || !Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ success: false, message: 'Invalid channel id' });
  }
  const channel = await assertChannelMember(channelId, req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Join this channel to edit the board' });
  }

  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
  if (!title) {
    return res.status(400).json({ success: false, message: 'title is required' });
  }

  const board = await ensureBoardWithDefaults(channelId);
  const last = await KanbanColumnModel.findOne({ boardId: board._id }).sort({ position: -1 }).lean();
  const position = (last?.position ?? -1) + 1;

  if (position >= 40) {
    return res.status(400).json({ success: false, message: 'Too many columns' });
  }

  const col = await KanbanColumnModel.create({ boardId: board._id, title, position });
  await logKanbanActivity({
    boardId: board._id,
    actorId: req.auth!.userId,
    type: 'column_created',
    meta: { columnId: String(col._id), title }
  });

  return res.status(201).json({
    success: true,
    data: { id: String(col._id), title: col.title, position: col.position }
  });
});

kanbanRouter.delete('/kanban/columns/:columnId', requireAuth, async (req: AuthedRequest, res) => {
  const columnId = singleParam(req.params.columnId);
  if (!columnId || !Types.ObjectId.isValid(columnId)) {
    return res.status(400).json({ success: false, message: 'Invalid column id' });
  }

  const column = await KanbanColumnModel.findById(columnId);
  if (!column) return res.status(404).json({ success: false, message: 'Column not found' });

  const board = await KanbanBoardModel.findById(column.boardId);
  if (!board) return res.status(404).json({ success: false, message: 'Board not found' });

  const channel = await assertChannelMember(String(board.channelId), req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  await KanbanCardModel.deleteMany({ columnId: column._id });
  await column.deleteOne();
  await logKanbanActivity({
    boardId: board._id,
    actorId: req.auth!.userId,
    type: 'column_deleted',
    meta: { columnId }
  });

  return res.json({ success: true, data: { id: columnId } });
});

kanbanRouter.post('/kanban/columns/:columnId/cards', requireAuth, async (req: AuthedRequest, res) => {
  const columnId = singleParam(req.params.columnId);
  if (!columnId || !Types.ObjectId.isValid(columnId)) {
    return res.status(400).json({ success: false, message: 'Invalid column id' });
  }

  const column = await KanbanColumnModel.findById(columnId);
  if (!column) return res.status(404).json({ success: false, message: 'Column not found' });

  const board = await KanbanBoardModel.findById(column.boardId);
  if (!board) return res.status(404).json({ success: false, message: 'Board not found' });

  const channel = await assertChannelMember(String(board.channelId), req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
  if (!title) {
    return res.status(400).json({ success: false, message: 'title is required' });
  }
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 2000) : '';

  const position = await nextCardPosition(column._id);
  const card = await KanbanCardModel.create({
    columnId: column._id,
    title,
    description,
    position,
    createdBy: new Types.ObjectId(req.auth!.userId)
  });

  await logKanbanActivity({
    boardId: board._id,
    actorId: req.auth!.userId,
    type: 'card_created',
    meta: { cardId: String(card._id), columnId, title }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: String(card._id),
      title: card.title,
      description: card.description,
      position: card.position,
      createdBy: String(card.createdBy)
    }
  });
});

kanbanRouter.patch('/kanban/cards/:cardId', requireAuth, async (req: AuthedRequest, res) => {
  const cardId = singleParam(req.params.cardId);
  if (!cardId || !Types.ObjectId.isValid(cardId)) {
    return res.status(400).json({ success: false, message: 'Invalid card id' });
  }

  const card = await KanbanCardModel.findById(cardId);
  if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

  const fromColumn = await KanbanColumnModel.findById(card.columnId);
  if (!fromColumn) return res.status(404).json({ success: false, message: 'Column not found' });

  const board = await KanbanBoardModel.findById(fromColumn.boardId);
  if (!board) return res.status(404).json({ success: false, message: 'Board not found' });

  const channel = await assertChannelMember(String(board.channelId), req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) : undefined;
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 2000) : undefined;
  const newColumnIdRaw = typeof req.body.columnId === 'string' ? req.body.columnId.trim() : '';

  let moved = false;
  if (newColumnIdRaw && Types.ObjectId.isValid(newColumnIdRaw) && String(card.columnId) !== newColumnIdRaw) {
    const toColumn = await KanbanColumnModel.findById(newColumnIdRaw);
    if (!toColumn || String(toColumn.boardId) !== String(board._id)) {
      return res.status(400).json({ success: false, message: 'Invalid target column' });
    }
    const fromColumnId = String(card.columnId);
    card.columnId = toColumn._id;
    card.position = await nextCardPosition(toColumn._id);
    moved = true;
    await logKanbanActivity({
      boardId: board._id,
      actorId: req.auth!.userId,
      type: 'card_moved',
      meta: { cardId, fromColumnId, toColumnId: newColumnIdRaw }
    });
  }

  if (title !== undefined) card.title = title;
  if (description !== undefined) card.description = description;

  await card.save();

  if (!moved && (title !== undefined || description !== undefined)) {
    await logKanbanActivity({
      boardId: board._id,
      actorId: req.auth!.userId,
      type: 'card_updated',
      meta: { cardId }
    });
  }

  return res.json({
    success: true,
    data: {
      id: String(card._id),
      title: card.title,
      description: card.description,
      columnId: String(card.columnId),
      position: card.position
    }
  });
});

kanbanRouter.delete('/kanban/cards/:cardId', requireAuth, async (req: AuthedRequest, res) => {
  const cardId = singleParam(req.params.cardId);
  if (!cardId || !Types.ObjectId.isValid(cardId)) {
    return res.status(400).json({ success: false, message: 'Invalid card id' });
  }

  const card = await KanbanCardModel.findById(cardId);
  if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

  const column = await KanbanColumnModel.findById(card.columnId);
  if (!column) return res.status(404).json({ success: false, message: 'Column not found' });

  const board = await KanbanBoardModel.findById(column.boardId);
  if (!board) return res.status(404).json({ success: false, message: 'Board not found' });

  const channel = await assertChannelMember(String(board.channelId), req.auth!.userId);
  if (!channel) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  await card.deleteOne();
  await logKanbanActivity({
    boardId: board._id,
    actorId: req.auth!.userId,
    type: 'card_deleted',
    meta: { cardId }
  });

  return res.json({ success: true, data: { id: cardId } });
});
