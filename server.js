// Twilio Media Streams <-> n8n WebSocket Bridge
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/twilio-process-audio';

const activeCalls = new Map();

app.get('/voice', (req, res) => {
  const wsUrl = `wss://${req.get('host')}/media-stream`;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="he-IL">שלום, אני הסוכן הדיגיטלי. במה אוכל לעזור?</Say>
    <Connect>
        <Stream url="${wsUrl}" />
    </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('📞 New Twilio call connected');
  
  let callSid = null;
  let streamSid = null;
  let audioBuffer = [];
  let silenceTimeout = null;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Call started: ${callSid}`);
          activeCalls.set(callSid, { ws, streamSid });
          break;

        case 'media':
          audioBuffer.push(msg.media.payload);
          
          clearTimeout(silenceTimeout);
          silenceTimeout = setTimeout(async () => {
            if (audioBuffer.length > 0) {
              await processAudio(callSid, streamSid, audioBuffer, ws);
              audioBuffer = [];
            }
          }, 500);
          break;

        case 'stop':
          console.log(`📞 Call ended: ${callSid}`);
          activeCalls.delete(callSid);
          clearTimeout(silenceTimeout);
          break;
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }
  });

  ws.on('close', () => {
    console.log('📞 Connection closed');
    if (callSid) activeCalls.delete(callSid);
    clearTimeout(silenceTimeout);
  });
});

async function processAudio(callSid, streamSid, audioChunks, ws) {
  try {
    const audioBase64 = audioChunks.join('');
    console.log(`🎤 Processing audio`);

    const response = await axios.post(N8N_WEBHOOK_URL, {
      callSid,
      streamSid,
      audioData: audioBase64
    }, {
      timeout: 30000
    });

    if (response.data.success && response.data.audio) {
      console.log(`🔊 Sending response`);
      
      const audioPayload = response.data.audio;
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
      
      console.log(`✅ Done`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

console.log('🎯 Ready!');
