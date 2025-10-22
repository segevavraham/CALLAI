// Twilio Media Streams <-> n8n WebSocket Bridge
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');

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
    
    console.log('📤 Payload:', JSON.stringify(payload, null, 2));
    
    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('📥 Response status:', response.status);
    console.log('📥 Response data:', JSON.stringify(response.data, null, 2));

    if (response.data.success && response.data.audio) {
      console.log('🔊 Sending Hebrew welcome audio to caller');
      
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
      
      console.log('✅ Welcome message sent successfully');
    } else {
      console.error('⚠️ Response missing success or audio field');
    }
  } catch (error) {
    console.error('❌ Error sending welcome message:');
    console.error('   Message:', error.message);
    console.error('   Status:', error.response?.status);
    console.error('   Status Text:', error.response?.statusText);
    console.error('   Response Data:', error.response?.data);
    console.error('   URL attempted:', N8N_WEBHOOK_URL);
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

    if (response.data.success && response.data.audio) {
      console.log(`🔊 Sending audio response to Twilio`);
      
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
      
      console.log(`✅ Audio sent successfully`);
    }
  } catch (error) {
    console.error('❌ Error processing audio:', error.message);
  }
}
