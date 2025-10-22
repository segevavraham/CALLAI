// Twilio Media Streams <-> n8n WebSocket Bridge - OPTIMIZED FOR REAL-TIME
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ הגדרות - OPTIMIZED
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://segevavraham.app.n8n.cloud/webhook/twilio-process-audio';
const SILENCE_TIMEOUT = 600; // 600ms instead of 1500ms - much faster! ⚡
const MIN_AUDIO_CHUNKS = 10; // Minimum chunks before processing
const CHUNK_SIZE = 160; // Twilio standard

// אחסון זמני של חיבורי WebSocket פעילים
const activeCalls = new Map();

// Express endpoint ל-TwiML של Twilio
app.get('/voice', (req, res) => {
  const wsUrl = `wss://${req.get('host')}/media-stream`;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wsUrl}" />
    </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// הפעל HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🎯 Twilio-n8n WebSocket Bridge - OPTIMIZED`);
  console.log(`⚡ Silence timeout: ${SILENCE_TIMEOUT}ms`);
});

// הפעל WebSocket server
const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('📞 New Twilio call connected');
  
  let callSid = null;
  let streamSid = null;
  let audioBuffer = [];
  let silenceTimeout = null;
  let welcomeSent = false;
  let isProcessing = false; // Prevent multiple simultaneous processing
  let currentAudioPlaying = false; // Track if AI is speaking

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Call started: ${callSid}`);
          activeCalls.set(callSid, { ws, streamSid, audioBuffer: [], isProcessing: false });
          
          // שלח הודעת פתיחה בעברית מיד!
          if (!welcomeSent) {
            welcomeSent = true;
            console.log('👋 Sending welcome message in 300ms...');
            setTimeout(() => {
              sendWelcomeMessage(callSid, streamSid, ws);
            }, 300);
          }
          break;

        case 'media':
          // אם AI מדבר - ignore user audio (prevent interruption feedback loop)
          if (currentAudioPlaying) {
            break;
          }

          audioBuffer.push(msg.media.payload);
          
          // ⚡ FASTER VAD - 600ms instead of 1500ms
          clearTimeout(silenceTimeout);
          silenceTimeout = setTimeout(async () => {
            // Only process if we have enough audio AND not currently processing
            if (audioBuffer.length >= MIN_AUDIO_CHUNKS && !isProcessing) {
              isProcessing = true;
              const chunksToProcess = [...audioBuffer];
              audioBuffer = [];
              
              console.log(`🎤 Processing ${chunksToProcess.length} audio chunks`);
              await processAudio(callSid, streamSid, chunksToProcess, ws);
              
              isProcessing = false;
            } else if (audioBuffer.length < MIN_AUDIO_CHUNKS) {
              console.log(`⏭️  Skipping - only ${audioBuffer.length} chunks (need ${MIN_AUDIO_CHUNKS})`);
              audioBuffer = [];
            }
          }, SILENCE_TIMEOUT);
          break;

        case 'stop':
          console.log(`📞 Call ended: ${callSid}`);
          activeCalls.delete(callSid);
          clearTimeout(silenceTimeout);
          break;
      }
    } catch (error) {
      console.error('❌ Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('📞 WebSocket connection closed');
    if (callSid) activeCalls.delete(callSid);
    clearTimeout(silenceTimeout);
  });
});

// 🎵 פונקציה להמיר MP3 ל-mulaw באמצעות ffmpeg
async function convertMp3ToMulaw(mp3Base64) {
  const tempDir = '/tmp';
  const timestamp = Date.now();
  const mp3Path = path.join(tempDir, `audio_${timestamp}.mp3`);
  const mulawPath = path.join(tempDir, `audio_${timestamp}.ulaw`);

  try {
    // כתוב MP3 לקובץ זמני
    const mp3Buffer = Buffer.from(mp3Base64, 'base64');
    await fs.writeFile(mp3Path, mp3Buffer);

    // המר באמצעות ffmpeg
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', mp3Path,
        '-ar', '8000',      // 8kHz sample rate (Twilio requirement)
        '-ac', '1',         // mono
        '-f', 'mulaw',      // output format
        mulawPath,
        '-y'                // overwrite output file
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          console.error('❌ ffmpeg error:', stderr);
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });

    // קרא את קובץ ה-mulaw
    const mulawBuffer = await fs.readFile(mulawPath);
    const mulawBase64 = mulawBuffer.toString('base64');
    
    console.log('✅ Converted:', {
      mp3: mp3Buffer.length,
      mulaw: mulawBuffer.length
    });

    // נקה קבצים זמניים
    await fs.unlink(mp3Path).catch(() => {});
    await fs.unlink(mulawPath).catch(() => {});

    return mulawBase64;
  } catch (error) {
    console.error('❌ Conversion error:', error.message);
    
    await fs.unlink(mp3Path).catch(() => {});
    await fs.unlink(mulawPath).catch(() => {});
    
    throw error;
  }
}

// פונקציה לשליחת הודעת פתיחה
async function sendWelcomeMessage(callSid, streamSid, ws) {
  try {
    console.log('💬 Generating Hebrew welcome message via n8n');
    
    const silenceBase64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    
    const payload = {
      callSid,
      streamSid,
      audioData: silenceBase64,
      welcomeMessage: true
    };
    
    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success && response.data.audio) {
      let audioPayload = response.data.audio;
      
      // המר MP3 ל-mulaw
      if (response.data.format === 'mp3') {
        console.log('🔄 Converting welcome MP3 to mulaw...');
        audioPayload = await convertMp3ToMulaw(audioPayload);
      }
      
      console.log('🔊 Playing welcome message');
      await sendAudioToTwilio(ws, streamSid, audioPayload);
      console.log('✅ Welcome message complete');
    }
  } catch (error) {
    console.error('❌ Error sending welcome:', error.message);
  }
}

async function processAudio(callSid, streamSid, audioChunks, ws) {
  const startTime = Date.now();
  
  try {
    const audioBase64 = audioChunks.join('');
    
    console.log(`🎤 Processing audio for ${callSid} (${audioChunks.length} chunks)`);

    const response = await axios.post(N8N_WEBHOOK_URL, {
      callSid,
      streamSid,
      audioData: audioBase64
    }, {
      timeout: 30000
    });

    const n8nTime = Date.now() - startTime;
    console.log(`📥 n8n responded in ${n8nTime}ms`);

    if (response.data.success && response.data.audio) {
      let audioPayload = response.data.audio;
      
      // המר MP3 ל-mulaw
      if (response.data.format === 'mp3') {
        const convertStart = Date.now();
        console.log('🔄 Converting response MP3 to mulaw...');
        audioPayload = await convertMp3ToMulaw(audioPayload);
        console.log(`✅ Converted in ${Date.now() - convertStart}ms`);
      }
      
      const totalTime = Date.now() - startTime;
      console.log(`🔊 Sending response (total: ${totalTime}ms)`);
      
      await sendAudioToTwilio(ws, streamSid, audioPayload);
      
      console.log(`✅ Complete response cycle: ${Date.now() - startTime}ms`);
    } else {
      console.error('⚠️  Invalid response from n8n');
    }
  } catch (error) {
    console.error('❌ Error processing audio:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Helper function to send audio to Twilio
async function sendAudioToTwilio(ws, streamSid, audioBase64) {
  const chunks = Math.ceil(audioBase64.length / CHUNK_SIZE);
  console.log(`📤 Sending ${chunks} audio chunks to Twilio`);
  
  for (let i = 0; i < audioBase64.length; i += CHUNK_SIZE) {
    const chunk = audioBase64.substr(i, CHUNK_SIZE);
    
    ws.send(JSON.stringify({
      event: 'media',
      streamSid: streamSid,
      media: {
        payload: chunk
      }
    }));
    
    // Small delay between chunks to avoid overwhelming Twilio
    if (i % (CHUNK_SIZE * 10) === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
