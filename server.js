// Twilio Media Streams <-> AI Voice Pipeline
require('dotenv').config();

const express = require('express');
const WebSocket = require('ws');

// Choose pipeline version
const PIPELINE_VERSION = process.env.PIPELINE_VERSION || 'v2';
const ConversationPipeline = PIPELINE_VERSION === 'v2'
  ? require('./conversation-pipeline-v2')
  : require('./conversation-pipeline');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'exsUS4vynmxd379XN4yO'; // Hebrew voice
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // Optional

if (!OPENAI_API_KEY) {
  console.error('❌ FATAL: OPENAI_API_KEY environment variable is required!');
  console.error('   Set it in your .env file or environment variables');
  process.exit(1);
}

if (!ELEVENLABS_API_KEY) {
  console.error('❌ FATAL: ELEVENLABS_API_KEY environment variable is required!');
  console.error('   Set it in your .env file or environment variables');
  process.exit(1);
}

// Store active pipelines
const activeCalls = new Map(); // Map<callSid, ConversationPipeline>

// 🏥 Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    activeCalls: activeCalls.size,
    timestamp: new Date().toISOString(),
    mode: 'Whisper + GPT-4 + ElevenLabs v3',
    voiceId: ELEVENLABS_VOICE_ID
  });
});

// 📊 Stats endpoint
app.get('/stats', (req, res) => {
  const calls = [];

  activeCalls.forEach((pipeline, callSid) => {
    const stats = pipeline.getStats();
    calls.push(stats);
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
  console.log(`\n${'━'.repeat(70)}`);
  console.log(`🚀 CALLAI Server Started`);
  console.log(`${'━'.repeat(70)}`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🎯 Pipeline Version: ${PIPELINE_VERSION.toUpperCase()}`);
  console.log(`\n✅ Pipeline Components:`);

  if (PIPELINE_VERSION === 'v2') {
    console.log(`   🎤 STT: ElevenLabs (Hebrew optimized)`);
    console.log(`   🤖 LLM: GPT-4 with dynamic prompts`);
    console.log(`   🎵 TTS: ElevenLabs v3 (Hebrew)`);
    console.log(`   🎯 State Machine: ENABLED`);
    console.log(`   💾 Conversation Memory: ENABLED`);
  } else {
    console.log(`   🎤 STT: Whisper API (Hebrew)`);
    console.log(`   🤖 LLM: GPT-4`);
    console.log(`   🎵 TTS: ElevenLabs v3 (Hebrew)`);
  }

  console.log(`   📊 n8n Analytics: ${N8N_WEBHOOK_URL ? 'ENABLED' : 'DISABLED'}`);

  console.log(`\n🎙️  Voice Settings:`);
  console.log(`   Voice ID: ${ELEVENLABS_VOICE_ID}`);
  console.log(`   Agent Name: ${process.env.AGENT_NAME || 'דני'}`);

  console.log(`\n${'━'.repeat(70)}\n`);
});

// הפעל WebSocket server
const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('📞 New Twilio call connected');

  let callSid = null;
  let streamSid = null;
  let pipeline = null;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Call started: ${callSid}`);

          try {
            // Create and initialize Conversation Pipeline
            const config = {
              openaiApiKey: OPENAI_API_KEY,
              elevenLabsApiKey: ELEVENLABS_API_KEY,
              elevenLabsVoiceId: ELEVENLABS_VOICE_ID,
              n8nWebhookUrl: N8N_WEBHOOK_URL
            };

            pipeline = new ConversationPipeline(ws, callSid, streamSid, config);
            await pipeline.initialize();

            // Store pipeline
            activeCalls.set(callSid, pipeline);

            console.log(`✅ Call ${callSid} ready - pipeline active`);
          } catch (error) {
            console.error(`❌ Failed to initialize call ${callSid}:`, error.message);
            ws.close();
          }
          break;

        case 'media':
          // Forward audio to pipeline
          if (pipeline) {
            await pipeline.handleAudio(msg.media.payload);
          } else {
            console.warn(`⚠️  No pipeline for call ${callSid}`);
          }
          break;

        case 'stop':
          console.log(`📞 Call ended: ${callSid}`);
          if (pipeline) {
            pipeline.close();
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
      const existingPipeline = activeCalls.get(callSid);
      if (existingPipeline) {
        existingPipeline.close();
      }
      activeCalls.delete(callSid);
    }
  });
});