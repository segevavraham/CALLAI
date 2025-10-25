// Twilio Media Streams <-> OpenAI Realtime API Bridge
require('dotenv').config();

const express = require('express');
const WebSocket = require('ws');
const AudioBridge = require('./audio-bridge');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('❌ FATAL: OPENAI_API_KEY environment variable is required!');
  console.error('   Set it in your .env file or environment variables');
  process.exit(1);
}

// Store active call bridges
const activeCalls = new Map(); // Map<callSid, AudioBridge>

// 🏥 Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    activeCalls: activeCalls.size,
    timestamp: new Date().toISOString(),
    mode: 'OpenAI Realtime API'
  });
});

// 📊 Stats endpoint
app.get('/stats', (req, res) => {
  const calls = [];

  activeCalls.forEach((bridge, callSid) => {
    const bridgeStats = bridge.getStats();
    calls.push(bridgeStats);
  });

  res.json({
    activeCalls: activeCalls.size,
    calls: calls
  });
});

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
  console.log(`🎯 Twilio ⟷ OpenAI Realtime API Bridge`);
  console.log(`\n✅ Features:`);
  console.log(`   🎤 Real-time voice conversation`);
  console.log(`   🇮🇱 Hebrew language support`);
  console.log(`   🔄 Bidirectional audio streaming`);
  console.log(`   📊 Live transcription and analytics\n`);
});

// הפעל WebSocket server
const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('📞 New Twilio call connected');

  let callSid = null;
  let streamSid = null;
  let bridge = null;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Call started: ${callSid}`);

          try {
            // Create and initialize Audio Bridge
            bridge = new AudioBridge(ws, callSid, streamSid);
            await bridge.initialize(OPENAI_API_KEY);

            // Store bridge
            activeCalls.set(callSid, bridge);

            console.log(`✅ Call ${callSid} ready - audio streaming active`);
          } catch (error) {
            console.error(`❌ Failed to initialize call ${callSid}:`, error.message);
            ws.close();
          }
          break;

        case 'media':
          // Forward audio to OpenAI via bridge
          if (bridge) {
            await bridge.handleTwilioAudio(msg.media.payload);
          } else {
            console.warn(`⚠️  No bridge for call ${callSid}`);
          }
          break;

        case 'stop':
          console.log(`📞 Call ended: ${callSid}`);
          if (bridge) {
            bridge.close();
          }
          activeCalls.delete(callSid);
          break;
      }
    } catch (error) {
      console.error('❌ Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('📞 WebSocket connection closed');
    if (callSid) {
      const existingBridge = activeCalls.get(callSid);
      if (existingBridge) {
        existingBridge.close();
      }
      activeCalls.delete(callSid);
    }
  });
});