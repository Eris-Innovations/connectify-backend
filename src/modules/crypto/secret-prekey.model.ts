import { InferSchemaType, Schema, model } from 'mongoose';

const secretPrekeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bundleId: { type: String, required: true, index: true },
    // opaque payload from client (e.g. libsignal prekey bundle), never inspected on server
    blob: { type: Buffer, required: true },
    used: { type: Boolean, default: false, index: true },
    expiresAt: { type: Date, required: true }
  },
  {
    timestamps: true
  }
);

secretPrekeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SecretPrekeyDocument = InferSchemaType<typeof secretPrekeySchema> & { _id: string };
export const SecretPrekeyModel = model('SecretPrekey', secretPrekeySchema);

