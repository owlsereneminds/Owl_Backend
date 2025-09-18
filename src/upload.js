// routes/upload.js
import express from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from "openai";
import { safeUnlink } from './utils.js';
import { getPool } from './db.js';

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});

// ------------------------------
// AWS Clients
// ------------------------------
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const sesClient = new SESClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------------------------
// Helpers
// ------------------------------
async function uploadBufferToS3(buffer, key, contentType = 'audio/webm') {
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error('S3_BUCKET env required');
  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: 'private'
  });
  await s3Client.send(cmd);
  return `s3://${Bucket}/${key}`;
}

function mergeAudioFiles(inputPaths, outPath) {
  return new Promise((resolve, reject) => {
    const proc = ffmpeg();
    inputPaths.forEach(p => proc.input(p));

    proc
      .complexFilter([`amix=inputs=${inputPaths.length}:duration=longest:dropout_transition=2`])
      .outputOptions(['-c:a libmp3lame', '-q:a 2'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outPath);
  });
}

// 📨 Send Email via SES
async function sendAnalysisEmail(toEmail, summary, soap, tips) {
  const fromEmail = process.env.FROM_EMAIL; // ✅ must be verified in SES
  if (!fromEmail) throw new Error("FROM_EMAIL env required for SES");

  const params = {
    Source: fromEmail,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: "Meeting Analysis Report" },
      Body: {
        Text: {
          Data: `Hello,

Here is the analysis of your recent meeting:

📌 Summary:
${summary}

📑 SOAP Notes:
${soap}

💡 Therapy Recommendations:
${tips}

Thanks,
Your Meeting Assistant`
        }
      }
    }
  };

  const command = new SendEmailCommand(params);
  await sesClient.send(command);
}

// ------------------------------
// Route
// ------------------------------
router.post('/', upload.any(), async (req, res) => {
  const tmpPaths = [];
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: 'No files uploaded' });

    const userAudio = files.find(f => f.fieldname === 'user_audio');
    const remotes = files.filter(f => f.fieldname.startsWith('remote_'));
    if (!userAudio) return res.status(400).json({ ok: false, error: 'user_audio required' });

    const meetingDataBlob = files.find(f => f.fieldname === 'meetingData');
    let meetingData = null;
    if (meetingDataBlob) {
      const str = meetingDataBlob.buffer.toString();
      meetingData = JSON.parse(str);
    }

    for (const f of [userAudio, ...remotes]) {
      const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${uuidv4()}-${f.originalname}`);
      await fs.promises.writeFile(tmpPath, f.buffer);
      tmpPaths.push(tmpPath);
    }

    const outName = `merged-${Date.now()}-${uuidv4()}.mp3`;
    const outPath = path.join(os.tmpdir(), outName);
    await mergeAudioFiles(tmpPaths, outPath);

    const mergedBuffer = await fs.promises.readFile(outPath);
    const mergedKey = `meet-recordings/${outName}`;
    const mergedS3 = await uploadBufferToS3(mergedBuffer, mergedKey, 'audio/mpeg');

    const originals = [];
    for (const f of files) {
      if (f.fieldname === 'meetingData') continue;
      const key = `meet-recordings/originals/${Date.now()}-${f.originalname}`;
      const s3path = await uploadBufferToS3(f.buffer, key, f.mimetype || 'audio/webm');
      originals.push({ field: f.fieldname, key, s3: s3path });
    }

    // 🎙 Whisper
    let transcriptText = '';
    try {
      const transcriptResp = await openai.audio.transcriptions.create({
        file: fs.createReadStream(outPath),
        model: "gpt-4o-mini",
        response_format: "text"
      });
      transcriptText = typeof transcriptResp === 'string'
        ? transcriptResp
        : transcriptResp.text ?? transcriptResp.transcription ?? JSON.stringify(transcriptResp);
    } catch (err) {
      console.error('❌ Whisper failed:', err);
    }

    // 🤖 GPT Analysis
    async function runPrompt(prompt, transcript) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt + transcript }]
      });
      return resp?.choices?.[0]?.message?.content ?? "";
    }

    const summary = await runPrompt("Summarize this transcript:\n\n", transcriptText);
    const soap = await runPrompt("Write SOAP notes for transcript:\n\n", transcriptText);
    const tips = await runPrompt("Give therapy recommendations for transcript:\n\n", transcriptText);

    // ------------------------------
    // 💾 Save to DB
    // ------------------------------
    let hostEmail = null;
    if (meetingData) {
      const pool = getPool();
      const profile = meetingData.userProfile;
      let userId = null;

      if (profile?.email) {
        const u = await pool.query(
          `INSERT INTO users (email, name, image, given_name, family_name, email_verified)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (email) DO UPDATE SET
             name=EXCLUDED.name, image=EXCLUDED.image,
             given_name=EXCLUDED.given_name, family_name=EXCLUDED.family_name,
             email_verified=EXCLUDED.email_verified, updated_at=NOW()
           RETURNING id`,
          [profile.email, profile.name, profile.picture, profile.given_name, profile.family_name, profile.email_verified]
        );
        userId = u.rows[0].id;
        hostEmail = profile.email; // ✅ Host email
      }

      const m = await pool.query(
        `INSERT INTO meetings (meeting_code, meeting_title, meet_url, user_id, duration_ms, raw_json)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          meetingData.meetingInfo.meetingCode,
          meetingData.meetingInfo.meetingTitle,
          meetingData.meetingInfo.meetUrl,
          userId,
          meetingData.durationMs,
          {
            ...meetingData,
            audio: { mergedS3, originals },
            analysis: { transcript: transcriptText, summary, soap, tips }
          }
        ]
      );
      const meetingId = m.rows[0].id;

      if (meetingData.participants) {
        for (const p of meetingData.participants) {
          await pool.query(
            `INSERT INTO participants (meeting_id,name,join_time) VALUES ($1,$2,$3)`,
            [meetingId, p.name, p.joinTime]
          );
        }
      }

      if (meetingData.engagement) {
        for (const e of meetingData.engagement) {
          await pool.query(
            `INSERT INTO engagement_signals (meeting_id,participant_name,video_on) VALUES ($1,$2,$3)`,
            [meetingId, e.name, e.videoOn]
          );
        }
      }
    }

    // ------------------------------
    // ✉️ Send Email to Host
    // ------------------------------
    if (hostEmail) {
      try {
        await sendAnalysisEmail(hostEmail, summary, soap, tips);
        console.log(`📨 Email sent to host: ${hostEmail}`);
      } catch (err) {
        console.error("❌ Email sending failed:", err);
      }
    }

    res.json({
      ok: true,
      merged: mergedS3,
      originals,
      analysis: { transcript: transcriptText, summary, soap, tips }
    });
  } catch (err) {
    console.error('🔥 Upload error:', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { await Promise.all(tmpPaths.map(p => safeUnlink(p))); } catch {}
  }
});

export default router;
