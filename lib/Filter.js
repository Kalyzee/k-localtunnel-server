import mongoose from 'mongoose';

const filterSchema = new mongoose.Schema(
  {
    pattern: { type: String, required: true },
    authorized: { type: Boolean, required: true },
    priority: { type: Number, default: 0 },
    // When set together with `authorized: true`, the allow is temporary and
    // will auto-flip to `authorized: false` at that moment. `null` means permanent.
    allowUntil: { type: Date, default: null },
  },
  { timestamps: true, collection: 'filters' }
);

export default mongoose.model('Filter', filterSchema);
