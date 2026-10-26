import mongoose from 'mongoose';

const nameSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
      maxlength: [100, 'name must be 100 characters or fewer'],
    },
  },
  {
    timestamps: true,
    // Present a clean API shape: id instead of _id, no __v.
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

export const Name = mongoose.model('Name', nameSchema);
