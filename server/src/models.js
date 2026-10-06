import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['employee', 'manager'], required: true },
  title: { type: String, default: 'Team member', maxlength: 80 },
  department: { type: String, default: 'General', maxlength: 80 }
}, { timestamps: true });

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clockIn: { type: Date, required: true },
  clockOut: { type: Date, default: null },
  clockInLocation: { latitude: Number, longitude: Number, accuracy: Number },
  clockOutLocation: { latitude: Number, longitude: Number, accuracy: Number }
}, { timestamps: true });
attendanceSchema.index({ employee: 1, clockIn: -1 });

export const User = mongoose.model('User', userSchema);
export const Attendance = mongoose.model('Attendance', attendanceSchema);
