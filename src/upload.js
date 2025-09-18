import express from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from "openai";
import fetch from "node-fetch"; // only needed if your Node version <18
import { safeUnlink } from './utils.js';

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // DO NOT hardcode
});

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
      .complexFilter([
        `amix=inputs=${inputPaths.length}:duration=longest:dropout_transition=2`
      ])
      .outputOptions(['-c:a libmp3lame', '-q:a 2'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outPath);
  });
}

router.options('/', (req, res) => res.sendStatus(204));

// Upload 2 or more audios: will return both originals + merged
// Replace your current router.post('/', ...) with this block

router.post('/', upload.any(), async (req, res) => {
  const tmpPaths = [];
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ ok: false, error: 'No files uploaded' });
    }

    // Separate mic + remotes
    const userAudio = files.find(f => f.fieldname === 'user_audio');
    const remotes = files.filter(f => f.fieldname.startsWith('remote_'));

    if (!userAudio) {
      return res.status(400).json({ ok: false, error: 'user_audio required' });
    }

    // Extract metadata (not files)
    const { meetUrl, timestamp } = req.body;

    // Write temp files (user + remotes)
    for (const f of [userAudio, ...remotes]) {
      const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${uuidv4()}-${f.originalname}`);
      await fs.promises.writeFile(tmpPath, f.buffer);
      tmpPaths.push(tmpPath);
    }

    // Merge into outPath
    const outName = `merged-${Date.now()}-${uuidv4()}.mp3`;
    const outPath = path.join(os.tmpdir(), outName);
    await mergeAudioFiles(tmpPaths, outPath);

    // read merged buffer and upload to S3
    const mergedBuffer = await fs.promises.readFile(outPath);
    const mergedKey = `meet-recordings/${outName}`;
    const mergedS3 = await uploadBufferToS3(mergedBuffer, mergedKey, 'audio/mpeg');

    // Upload originals
    const originals = [];
    for (const f of files) {
      const key = `meet-recordings/originals/${Date.now()}-${f.originalname}`;
      const s3path = await uploadBufferToS3(f.buffer, key, f.mimetype || 'audio/webm');
      originals.push({ field: f.fieldname, key, s3: s3path });
    }

    // ------------------------------
    // Transcribe with Whisper (Node: use fs.createReadStream)
    // ------------------------------
    let transcriptText = '';
    try {
      console.log('⏳ Sending merged audio to Whisper for transcription...');
      const transcriptResp = await openai.audio.transcriptions.create({
        file: fs.createReadStream(outPath),
        model: "whisper-1",
        response_format: "text"
      });

      // transcriptResp may be a string or an object depending on SDK/version
      if (typeof transcriptResp === 'string') {
        transcriptText = transcriptResp;
      } else if (transcriptResp && typeof transcriptResp === 'object') {
        // Common shapes: { text: "..." } or { transcription: "..." }
        transcriptText = transcriptResp.text ?? transcriptResp.transcription ?? JSON.stringify(transcriptResp);
      } else {
        transcriptText = String(transcriptResp);
      }
      console.log("🎙️ Transcript (first 300 chars):", transcriptText.slice(0, 300));
    } catch (err) {
      console.error('❌ Whisper transcription failed:', err);
      throw err;
    }

    // ------------------------------
    // Run analysis prompts (GPT)
    // ------------------------------
    const prompt_summary = `You are an expert clinical assistant. Summarize the following session transcript in clear, concise language. Highlight the main themes, client concerns, and any significant progress or challenges. Keep the summary factual and professional, no personal opinions and everything in English.\n\nTranscript: `;
    const prompt_soap = `You are a mental health professional writing SOAP notes. Generate structured SOAP notes from the transcript below:\n\nS (Subjective): Client’s self-reported concerns, feelings, and symptoms.\nO (Objective): Observable behaviors, mood, and clinician’s observations.\nA (Assessment): Clinical impressions, patterns, and progress.\nP (Plan): Next steps, interventions, or recommendations.\n\nEnsure clarity, professionalism, and avoid adding details not in the transcript.\n\nTranscript: `;
    const prompt_tips = `You are a therapist providing guidance. Based on the transcript below, generate treatment tips and practical recommendations tailored to the client. Keep them empathetic, actionable, and evidence-based. Focus on coping strategies, skill-building, and next steps.\n\nTranscript: `;

    async function runPrompt(prompt, transcript) {
      try {
        console.log('⏳ Sending prompt to GPT (preview):', prompt.slice(0, 80));
        const resp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt + transcript }]
        });

        // defensive extraction
        const content =
          resp?.choices?.[0]?.message?.content ??
          resp?.choices?.[0]?.text ??
          (typeof resp === 'string' ? resp : JSON.stringify(resp));
        return content;
      } catch (err) {
        console.error('❌ OpenAI prompt failed:', err);
        throw err;
      }
    }

    const summary = await runPrompt(prompt_summary, transcriptText);
    console.log("📄 Summary (first 300 chars):", summary?.slice(0, 300));

    const soap = await runPrompt(prompt_soap, transcriptText);
    console.log("🧾 SOAP (first 300 chars):", soap?.slice(0, 300));

    const tips = await runPrompt(prompt_tips, transcriptText);
    console.log("💡 Tips (first 300 chars):", tips?.slice(0, 300));

    // respond
    res.json({
      ok: true,
      merged: mergedS3,
      originals,
      meta: { meetUrl, timestamp },
      analysis: {
        transcript: transcriptText,
        summary,
        soap,
        tips
      }
    });

  } catch (err) {
    console.error('🔥 Upload route error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      stack: err.stack
    });
  } finally {
    // always cleanup tmp files (and merged)
    try {
      await Promise.all(tmpPaths.map(p => safeUnlink(p)));
    } catch (e) {
      console.warn('cleanup warning', e);
    }
  }
});




export default router;
