import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    keyHash: { type: String, required: true },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    lastIp: { type: String, default: null },
  },
  { timestamps: true, collection: 'apiKeys' }
);

export default mongoose.model('ApiKey', apiKeySchema);
