// Twilio Media Streams <-> n8n WebSocket Bridge
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ הגדרות
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://segevavraham.app.n8n.cloud/webhook/twilio-process-audio';

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
  console.log(`🎯 Twilio-n8n WebSocket Bridge is ready!`);
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

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Call started: ${callSid}`);
          activeCalls.set(callSid, { ws, streamSid });
          
          // שלח הודעת פתיחה בעברית מיד!
          if (!welcomeSent) {
            welcomeSent = true;
            setTimeout(() => {
              sendWelcomeMessage(callSid, streamSid, ws);
            }, 500);
          }
          break;

        case 'media':
          audioBuffer.push(msg.media.payload);
          
          clearTimeout(silenceTimeout);
          silenceTimeout = setTimeout(async () => {
            if (audioBuffer.length > 0) {
              await processAudio(callSid, streamSid, audioBuffer, ws);
              audioBuffer = [];
            }
          }, 1500);
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
    console.log('🔄 Starting MP3 to mulaw conversion');
    
    // כתוב MP3 לקובץ זמני
    const mp3Buffer = Buffer.from(mp3Base64, 'base64');
    await fs.writeFile(mp3Path, mp3Buffer);
    console.log('📝 MP3 file written:', mp3Path, 'size:', mp3Buffer.length);

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
          console.log('✅ ffmpeg conversion successful');
          resolve();
        } else {
          console.error('❌ ffmpeg error output:', stderr);
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('❌ ffmpeg spawn error:', err);
        reject(err);
      });
    });

    // קרא את קובץ ה-mulaw
    const mulawBuffer = await fs.readFile(mulawPath);
    const mulawBase64 = mulawBuffer.toString('base64');
    
    console.log('✅ Conversion complete:', {
      mp3Size: mp3Buffer.length,
      mulawSize: mulawBuffer.length,
      mulawBase64Length: mulawBase64.length
    });

    // נקה קבצים זמניים
    await fs.unlink(mp3Path).catch(() => {});
    await fs.unlink(mulawPath).catch(() => {});

    return mulawBase64;
  } catch (error) {
    console.error('❌ Conversion error:', error.message);
    
    // נקה קבצים זמניים במקרה של שגיאה
    await fs.unlink(mp3Path).catch(() => {});
    await fs.unlink(mulawPath).catch(() => {});
    
    throw error;
  }
}

// פונקציה לשליחת הודעת פתיחה
async function sendWelcomeMessage(callSid, streamSid, ws) {
  try {
    console.log('👋 Generating Hebrew welcome message via n8n');
    console.log('📡 Sending to URL:', N8N_WEBHOOK_URL);
    
    const silenceBase64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    
    const payload = {
      callSid,
      streamSid,
      audioData: silenceBase64,
      welcomeMessage: true
    };
    
    console.log('📤 Sending welcome request...');
    
    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('📥 Response received:', {
      status: response.status,
      format: response.data.format,
      hasAudio: !!response.data.audio
    });

    if (response.data.success && response.data.audio) {
      let audioPayload = response.data.audio;
      
      // בדוק אם צריך להמיר MP3 ל-mulaw
      if (response.data.format === 'mp3') {
        console.log('🔄 Converting MP3 welcome message to mulaw...');
        audioPayload = await convertMp3ToMulaw(audioPayload);
      }
      
      console.log('🔊 Sending Hebrew welcome audio to caller');
      
      const chunkSize = 160;
      for (let i = 0; i < audioPayload.length; i += chunkSize) {
        const chunk = audioPayload.substr(i, chunkSize);
        
        ws.send(JSON.stringify({
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: chunk
          }
        }));
      }
      
      console.log('✅ Welcome message sent successfully');
    } else {
      console.error('⚠️ Response missing success or audio field');
    }
  } catch (error) {
    console.error('❌ Error sending welcome message:');
    console.error('   Message:', error.message);
    console.error('   Status:', error.response?.status);
    console.error('   Response Data:', JSON.stringify(error.response?.data, null, 2));
  }
}

async function processAudio(callSid, streamSid, audioChunks, ws) {
  try {
    const audioBase64 = audioChunks.join('');
    
    console.log(`🎤 Processing audio for call ${callSid}`);

    const response = await axios.post(N8N_WEBHOOK_URL, {
      callSid,
      streamSid,
      audioData: audioBase64
    }, {
      timeout: 30000
    });

    console.log('📥 n8n response:', {
      success: response.data.success,
      format: response.data.format,
      textLength: response.data.text?.length,
      audioLength: response.data.audio?.length
    });

    if (response.data.success && response.data.audio) {
      let audioPayload = response.data.audio;
      
      // בדוק אם צריך להמיר MP3 ל-mulaw
      if (response.data.format === 'mp3') {
        console.log('🔄 Converting MP3 response to mulaw...');
        audioPayload = await convertMp3ToMulaw(audioPayload);
      }
      
      console.log(`🔊 Sending audio response to Twilio (${audioPayload.length} chars)`);
      
      const chunkSize = 160;
      for (let i = 0; i < audioPayload.length; i += chunkSize) {
        const chunk = audioPayload.substr(i, chunkSize);
        
        ws.send(JSON.stringify({
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: chunk
          }
        }));
      }
      
      console.log(`✅ Audio sent successfully`);
    } else {
      console.error('⚠️ Invalid response from n8n:', response.data);
    }
  } catch (error) {
    console.error('❌ Error processing audio:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}
