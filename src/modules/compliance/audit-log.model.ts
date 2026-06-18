import { InferSchemaType, Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true, index: true },
    targetId: { type: String, default: '', index: true },
    region: { type: String, enum: ['eu', 'apac', 'na'], default: 'na', index: true },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema> & { _id: string };
export const AuditLogModel = model('AuditLog', auditLogSchema);

