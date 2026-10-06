import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { User, Attendance } from './models.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '32kb' }));
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me';

const safeUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, title: u.title, department: u.department });
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  try { if (!token) throw new Error(); req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in to continue.' }); }
}
const managerOnly = (req, res, next) => req.user.role === 'manager' ? next() : res.status(403).json({ error: 'Manager access required.' });
const publicAttendance = (a) => ({ id: String(a._id), employee: a.employee?._id ? safeUser(a.employee) : a.employee, clockIn: a.clockIn, clockOut: a.clockOut, clockInLocation: a.clockInLocation, clockOutLocation: a.clockOutLocation });
function validLocation(location) {
  if (location == null) return null;
  const { latitude, longitude, accuracy } = location;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Location coordinates are invalid.');
  return { latitude, longitude, ...(Number.isFinite(accuracy) ? { accuracy } : {}) };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, title, department, managerCode } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
    if (!['employee', 'manager'].includes(role)) return res.status(400).json({ error: 'Choose employee or manager.' });
    if (role === 'manager' && (!process.env.MANAGER_SIGNUP_CODE || managerCode !== process.env.MANAGER_SIGNUP_CODE)) return res.status(403).json({ error: 'A valid manager registration code is required.' });
    const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role, title: title?.trim() || (role === 'manager' ? 'People manager' : 'Team member'), department: department?.trim() || 'General' });
    const token = jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) { res.status(err.code === 11000 ? 409 : 400).json({ error: err.code === 11000 ? 'An account with that email already exists.' : err.message }); }
});
app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ email: String(req.body?.email || '').trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body?.password || '', user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (req.body?.role && user.role !== req.body.role) return res.status(403).json({ error: `This account is registered as an ${user.role}. Choose the matching sign-in option.` });
  const token = jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: safeUser(user) });
});
app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { password, confirmPassword } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Enter the email address for your account.' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Choose a password with at least 8 characters.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'The passwords do not match.' });
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'No account was found with that email address.' });
  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();
  res.json({ message: 'Password updated. Sign in with your new password.' });
});
app.get('/api/me', auth, async (req, res) => { const user = await User.findById(req.user.sub); if (!user) return res.status(404).json({ error: 'Account not found.' }); res.json({ user: safeUser(user) }); });
app.get('/api/attendance/mine', auth, async (req, res) => {
  const rows = await Attendance.find({ employee: req.user.sub }).sort({ clockIn: -1 }).limit(60).lean();
  res.json({ records: rows.map(publicAttendance) });
});
app.post('/api/attendance/clock-in', auth, async (req, res) => {
  try {
    const current = await Attendance.findOne({ employee: req.user.sub, clockOut: null });
    if (current) return res.status(409).json({ error: 'You are already clocked in.' });
    const record = await Attendance.create({ employee: req.user.sub, clockIn: new Date(), clockInLocation: validLocation(req.body?.location) });
    res.status(201).json({ record: publicAttendance(record) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/attendance/clock-out', auth, async (req, res) => {
  try {
    const record = await Attendance.findOne({ employee: req.user.sub, clockOut: null }).sort({ clockIn: -1 });
    if (!record) return res.status(409).json({ error: 'You are not clocked in.' });
    record.clockOut = new Date(); record.clockOutLocation = validLocation(req.body?.location); await record.save();
    res.json({ record: publicAttendance(record) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.get('/api/manager/overview', auth, managerOnly, async (req, res) => {
  const [employees, records, active] = await Promise.all([
    User.find({ role: 'employee' }).select('-passwordHash').sort({ name: 1 }).lean(),
    Attendance.find().populate('employee', 'name email title department role').sort({ clockIn: -1 }).limit(150).lean(),
    Attendance.find({ clockOut: null }).populate('employee', 'name email title department role').sort({ clockIn: -1 }).lean()
  ]);
  res.json({ employees: employees.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, title: u.title, department: u.department })), records: records.map(publicAttendance), active: active.map(publicAttendance) });
});
app.get('/api/assistant/health', auth, async (_req, res) => {
  const base = process.env.RAG_API_URL;
  if (!base) return res.json({ ready: false, message: 'Python policy service URL is not configured.' });
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    res.json({ ready: response.ok && data.ok === true && data.geminiConfigured === true, model: data.llm, message: data.geminiConfigured ? 'Gemini is ready.' : 'Add GEMINI_API_KEY to the Python RAG service settings.' });
  } catch {
    res.json({ ready: false, message: 'Python policy service is unreachable. Check its deployment and RAG_API_URL.' });
  }
});
app.post('/api/assistant/ask', auth, async (req, res) => {
  const base = process.env.RAG_API_URL;
  if (!base) return res.status(503).json({ error: 'The Python policy service URL is missing. Set RAG_API_URL in the Node service settings.' });
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: req.body?.question, role: req.user.role }), signal: AbortSignal.timeout(45000) });
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    const timedOut = err.name === 'TimeoutError';
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'The policy assistant took too long to respond. Try again shortly.' : 'PeopleClock cannot reach the Python policy service. Check that it is running locally or that RAG_API_URL points to the deployed peopleclock-rag service.' });
  }
});

const clientBuild = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get('*path', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientBuild, 'index.html')));
}

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });
try {
  if (!process.env.MONGODB_URI || /[<>]/.test(process.env.MONGODB_URI)) throw new Error('MONGODB_URI is missing or still contains template placeholders. In .env, replace it with the connection string from MongoDB Atlas → Connect → Drivers (or your local MongoDB URI).');
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(PORT, '0.0.0.0', () => console.log(`PeopleClock API listening on ${PORT}`));
} catch (err) { console.error(`Startup failed: ${err.message}`); process.exit(1); }
