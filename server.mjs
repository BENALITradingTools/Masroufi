import express from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/api/health', (_req, res) => res.json({ ok: true, transcriptionConfigured: Boolean(process.env.OPENAI_API_KEY) }));
const requestCounts = new Map();
app.post('/api/transcribe', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (requestCounts.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ error: 'وصلت إلى حد التسجيلات المؤقت لهذا الخادم. حاول لاحقاً.' });
  recent.push(now); requestCounts.set(ip, recent); next();
}, upload.single('audio'), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'الخادم غير مهيأ بعد: أضف OPENAI_API_KEY في إعدادات الاستضافة.' });
    if (!req.file) return res.status(400).json({ error: 'لم يصل أي ملف صوتي.' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const allowed = new Set(['.m4a', '.mp4', '.webm', '.mp3', '.wav', '.mpeg', '.mpga', '.ogg']);
    if (!allowed.has(ext)) return res.status(415).json({ error: 'صيغة الصوت غير مدعومة في هذا المتصفح.' });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const file = await toFile(req.file.buffer, req.file.originalname, { type: req.file.mimetype || 'application/octet-stream' });
    const result = await client.audio.transcriptions.create({
      file,
      model: 'gpt-transcribe',
      prompt: 'Transcribe exactly in the original language. The speaker uses Algerian Darija mixed with Arabic and French, discussing personal income and expenses in Algerian dinars. Preserve amounts and transaction words accurately. Do not translate.'
    });
    res.json({ text: result.text || '' });
  } catch (error) {
    console.error('Transcription error:', error?.status || '', error?.message || error);
    res.status(502).json({ error: 'تعذر تحويل التسجيل حالياً. حاول مجدداً بعد قليل.' });
  }
});
app.listen(PORT, () => console.log(`Masroufi server listening on ${PORT}`));
