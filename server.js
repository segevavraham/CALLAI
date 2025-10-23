// Twilio Media Streams <-> n8n WebSocket Bridge - OPTIMIZED FOR REAL-TIME
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ הגדרות - OPTIMIZED FOR REAL-TIME CONVERSATION
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://segevavraham.app.n8n.cloud/webhook/twilio-process-audio';
const SILENCE_TIMEOUT = 600; // 600ms - ultra-fast response ⚡⚡
const MIN_AUDIO_CHUNKS = 8; // Very low threshold - prioritize speed 🎤
const CHUNK_SIZE = 160; // Twilio standard
const MAX_IDLE_TIME = 30000; // 30 seconds of silence before timeout warning
const CONVERSATION_TIMEOUT = 300000; // 5 minutes total conversation limit
const MAX_HISTORY_MESSAGES = 50; // Maximum messages to keep in history (prevent memory issues)

// 📊 Performance tracking
let performanceStats = {
  totalCalls: 0,
  averageProcessingTime: 0,
  averageN8nTime: 0,
  averageConversionTime: 0
};

// אחסון זמני של חיבורי WebSocket פעילים
const activeCalls = new Map();

// 🏥 Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    activeCalls: activeCalls.size,
    timestamp: new Date().toISOString(),
    config: {
      silenceTimeout: SILENCE_TIMEOUT,
      minAudioChunks: MIN_AUDIO_CHUNKS,
      maxIdleTime: MAX_IDLE_TIME,
      maxHistoryMessages: MAX_HISTORY_MESSAGES
    }
  });
});

// 📊 Stats endpoint
app.get('/stats', (req, res) => {
  const stats = {
    activeCalls: activeCalls.size,
    performance: {
      totalProcessedCalls: performanceStats.totalCalls,
      averageN8nTime: Math.round(performanceStats.averageN8nTime),
      averageProcessingTime: Math.round(performanceStats.averageProcessingTime),
      averageConversionTime: Math.round(performanceStats.averageConversionTime)
    },
    calls: []
  };

  activeCalls.forEach((callData, callSid) => {
    stats.calls.push({
      callSid,
      duration: Math.round((Date.now() - callData.startTime) / 1000),
      turns: callData.turnCount,
      historySize: callData.conversationHistory.length,
      isProcessing: callData.isProcessing,
      isSpeaking: callData.currentAudioPlaying
    });
  });

  res.json(stats);
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
  console.log(`🎯 Twilio-n8n WebSocket Bridge - ENTERPRISE QUALITY`);
  console.log(`\n📋 Configuration:`);
  console.log(`   ⚡ Silence timeout: ${SILENCE_TIMEOUT}ms`);
  console.log(`   🎤 Min audio chunks: ${MIN_AUDIO_CHUNKS}`);
  console.log(`   ⏱️  Max idle time: ${MAX_IDLE_TIME / 1000}s`);
  console.log(`   🔄 Conversation timeout: ${CONVERSATION_TIMEOUT / 1000}s`);
  console.log(`\n✅ Features:`);
  console.log(`   📚 Full conversation history tracking`);
  console.log(`   🚨 Automatic error recovery`);
  console.log(`   ⏱️  Intelligent timeout management`);
  console.log(`   📊 Detailed call analytics\n`);
});

// הפעל WebSocket server
const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('📞 New Twilio call connected');

  let callSid = null;
  let streamSid = null;
  let welcomeSent = false;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Call started: ${callSid}`);
          activeCalls.set(callSid, {
            ws,
            streamSid,
            audioBuffer: [],
            isProcessing: false,
            currentAudioPlaying: false,  // ✅ Track AI speaking state
            conversationHistory: [],     // 📚 Full conversation context
            startTime: Date.now(),       // ⏱️  Track call duration
            lastActivityTime: Date.now(), // 👂 Track user activity
            turnCount: 0,                // 🔢 Track conversation turns
            idleWarningsSent: 0,         // ⚠️  Track timeout warnings
            silenceTimeout: null         // 🎤 VAD timeout reference
          });
          
          // ⏱️  הפעל ניהול timeout
          setupIdleTimeout(callSid);

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
          const callData = activeCalls.get(callSid);
          if (!callData) {
            console.warn(`⚠️  No call data for ${callSid}`);
            break;
          }

          // Debug logging - only log every 50 chunks to avoid spam
          if (callData.audioBuffer.length % 50 === 0 && callData.audioBuffer.length > 0) {
            console.log(`📊 Audio buffer: ${callData.audioBuffer.length} chunks | Processing: ${callData.isProcessing} | Speaking: ${callData.currentAudioPlaying}`);
          }

          if (callData.currentAudioPlaying) {
            // AI is speaking, ignore user input to prevent feedback
            break;
          }

          // ✅ Use callData.audioBuffer
          callData.audioBuffer.push(msg.media.payload);

          // ⚡ Real-time VAD - use callData.silenceTimeout
          if (callData.silenceTimeout) {
            clearTimeout(callData.silenceTimeout);
          }

          callData.silenceTimeout = setTimeout(async () => {
            const currentCallData = activeCalls.get(callSid);
            if (!currentCallData) return;

            // Only process if we have enough audio AND not currently processing
            if (currentCallData.audioBuffer.length >= MIN_AUDIO_CHUNKS && !currentCallData.isProcessing) {
              currentCallData.isProcessing = true;
              const chunksToProcess = [...currentCallData.audioBuffer];
              currentCallData.audioBuffer = []; // ✅ Clear buffer for next turn

              console.log(`\n🎤 Processing ${chunksToProcess.length} audio chunks (Turn ${currentCallData.turnCount + 1})`);
              await processAudio(callSid, streamSid, chunksToProcess, ws);
              // Note: processAudio will reset isProcessing flag when done
            } else if (currentCallData.audioBuffer.length < MIN_AUDIO_CHUNKS) {
              console.log(`⏭️  Skipping - only ${currentCallData.audioBuffer.length} chunks (need ${MIN_AUDIO_CHUNKS})`);
              currentCallData.audioBuffer = [];
            } else if (currentCallData.isProcessing) {
              console.log(`⏸️  Already processing, buffering ${currentCallData.audioBuffer.length} chunks`);
            }
          }, SILENCE_TIMEOUT);
          break;

        case 'stop':
          console.log(`📞 Call ended: ${callSid}`);
          const endCallData = activeCalls.get(callSid);
          if (endCallData) {
            // נקה את כל ה-timeouts
            if (endCallData.idleTimeout) clearTimeout(endCallData.idleTimeout);
            if (endCallData.silenceTimeout) clearTimeout(endCallData.silenceTimeout);

            // 📊 לוג סטטיסטיקות שיחה
            const callDuration = Date.now() - endCallData.startTime;
            console.log(`📊 Call Stats:`);
            console.log(`   ⏱️  Duration: ${Math.round(callDuration / 1000)}s`);
            console.log(`   🔢 Turns: ${endCallData.turnCount}`);
            console.log(`   📚 Messages: ${endCallData.conversationHistory.length}`);
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
      const closeCallData = activeCalls.get(callSid);
      if (closeCallData) {
        if (closeCallData.idleTimeout) clearTimeout(closeCallData.idleTimeout);
        if (closeCallData.silenceTimeout) clearTimeout(closeCallData.silenceTimeout);
      }
      activeCalls.delete(callSid);
    }
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

// 📚 פונקציה לניהול גודל היסטוריה (למנוע בעיות זיכרון)
function manageHistorySize(callData) {
  if (callData.conversationHistory.length > MAX_HISTORY_MESSAGES) {
    // שמור רק את ההודעות האחרונות, אבל תמיד שמור את הודעת הפתיחה
    const welcomeMessage = callData.conversationHistory.find(msg => msg.type === 'welcome');
    const recentMessages = callData.conversationHistory.slice(-MAX_HISTORY_MESSAGES + 1);

    if (welcomeMessage && !recentMessages.some(msg => msg.type === 'welcome')) {
      callData.conversationHistory = [welcomeMessage, ...recentMessages];
    } else {
      callData.conversationHistory = recentMessages;
    }

    console.log(`📚 History trimmed to ${callData.conversationHistory.length} messages`);
  }
}

// 🚨 פונקציה לשליחת הודעת שגיאה
async function sendErrorMessage(callSid, streamSid, ws, errorType = 'general') {
  try {
    console.log(`⚠️  Sending error recovery message for ${callSid}`);

    const errorMessages = {
      general: 'סליחה, נתקלתי בבעיה טכנית. אפשר לחזור על מה שאמרת?',
      timeout: 'סליחה, לא שמעתי אותך. אתה עדיין איתי?',
      n8n_error: 'סליחה, יש לי בעיה זמנית. נסה שוב בבקשה.'
    };

    const payload = {
      callSid,
      streamSid,
      audioData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      errorRecovery: true,
      errorType,
      errorMessage: errorMessages[errorType] || errorMessages.general
    };

    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data.success && response.data.audio) {
      let audioPayload = response.data.audio;

      if (response.data.format === 'mp3') {
        audioPayload = await convertMp3ToMulaw(audioPayload);
      }

      await sendAudioToTwilio(ws, streamSid, audioPayload);
      console.log('✅ Error recovery message sent');
    }
  } catch (error) {
    console.error('❌ Failed to send error message:', error.message);
    // אם גם הודעת השגיאה נכשלה, פשוט נמשיך
  }
}

// ⏱️  פונקציה לניהול timeouts
function setupIdleTimeout(callSid) {
  const callData = activeCalls.get(callSid);
  if (!callData) return;

  // נקה timeout קודם אם קיים
  if (callData.idleTimeout) {
    clearTimeout(callData.idleTimeout);
  }

  callData.idleTimeout = setTimeout(async () => {
    const timeSinceLastActivity = Date.now() - callData.lastActivityTime;

    if (timeSinceLastActivity >= MAX_IDLE_TIME && callData.idleWarningsSent < 2) {
      console.log(`⚠️  User idle for ${timeSinceLastActivity}ms on call ${callSid}`);
      callData.idleWarningsSent++;
      await sendErrorMessage(callSid, callData.streamSid, callData.ws, 'timeout');

      // הגדר timeout נוסף
      setupIdleTimeout(callSid);
    } else if (callData.idleWarningsSent >= 2) {
      console.log(`📞 Ending call ${callSid} due to inactivity`);
      callData.ws.close();
    }
  }, MAX_IDLE_TIME);
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

      // 📚 הוסף להיסטוריית השיחה
      const callData = activeCalls.get(callSid);
      if (callData && response.data.text) {
        callData.conversationHistory.push({
          role: 'assistant',
          content: response.data.text,
          timestamp: Date.now(),
          type: 'welcome'
        });
        callData.turnCount++;
      }

      console.log('✅ Welcome message complete');
    }
  } catch (error) {
    console.error('❌ Error sending welcome:', error.message);
  }
}

async function processAudio(callSid, streamSid, audioChunks, ws) {
  const timings = {
    start: Date.now(),
    preparePayload: 0,
    n8nRequest: 0,
    n8nResponse: 0,
    conversion: 0,
    sendToTwilio: 0,
    updateHistory: 0,
    total: 0
  };

  const callData = activeCalls.get(callSid);

  if (!callData) {
    console.error(`❌ No call data found for ${callSid}`);
    return;
  }

  try {
    const audioBase64 = audioChunks.join('');

    // 👂 עדכן זמן פעילות אחרון
    callData.lastActivityTime = Date.now();

    // 📊 לוג מפורט של מצב השיחה
    const callDuration = Date.now() - callData.startTime;
    console.log(`\n🎤 Processing audio for ${callSid}`);
    console.log(`   📦 Chunks: ${audioChunks.length}`);
    console.log(`   🔢 Turn: ${callData.turnCount + 1}`);
    console.log(`   ⏱️  Duration: ${Math.round(callDuration / 1000)}s`);
    console.log(`   📚 History: ${callData.conversationHistory.length} messages`);
    console.log(`   🔧 Initial state: isProcessing=${callData.isProcessing}, speaking=${callData.currentAudioPlaying}`);

    // 🔄 הכן payload עם היסטוריה מלאה
    const payload = {
      callSid,
      streamSid,
      audioData: audioBase64,
      conversationHistory: callData.conversationHistory, // 📚 CRITICAL: שלח את כל ההיסטוריה!
      metadata: {
        turnCount: callData.turnCount,
        callDuration: callDuration,
        timestamp: Date.now()
      }
    };

    timings.preparePayload = Date.now() - timings.start;

    // ⏱️ Track n8n request time
    const n8nStartTime = Date.now();
    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });

    timings.n8nResponse = Date.now() - n8nStartTime;
    console.log(`📥 n8n responded in ${timings.n8nResponse}ms`);

    if (response.data.success && response.data.audio) {
      let audioPayload = response.data.audio;

      // המר MP3 ל-mulaw
      if (response.data.format === 'mp3') {
        const convertStart = Date.now();
        console.log('🔄 Converting response MP3 to mulaw...');
        audioPayload = await convertMp3ToMulaw(audioPayload);
        timings.conversion = Date.now() - convertStart;
        console.log(`✅ Converted in ${timings.conversion}ms`);
      }

      const sendStart = Date.now();
      try {
        // ✅ Mark that AI is speaking JUST before sending
        callData.currentAudioPlaying = true;

        await sendAudioToTwilio(ws, streamSid, audioPayload);
        timings.sendToTwilio = Date.now() - sendStart;

        // ✅ IMMEDIATELY mark that AI stopped speaking
        callData.currentAudioPlaying = false;
        console.log(`🔊 Audio sent successfully in ${timings.sendToTwilio}ms`);
      } catch (audioError) {
        console.error('❌ Error sending audio to Twilio:', audioError.message);
        timings.sendToTwilio = Date.now() - sendStart;
        callData.currentAudioPlaying = false;
        // Continue anyway - we'll reset flags below
      }

      const historyStart = Date.now();

      // 📚 עדכן היסטוריית שיחה עם שני הצדדים
      if (response.data.userText) {
        callData.conversationHistory.push({
          role: 'user',
          content: response.data.userText,
          timestamp: Date.now(),
          audioChunks: audioChunks.length
        });
      }

      if (response.data.text) {
        callData.conversationHistory.push({
          role: 'assistant',
          content: response.data.text,
          timestamp: Date.now(),
          processingTime: timings.n8nResponse
        });
      }

      // 📚 נהל גודל היסטוריה
      manageHistorySize(callData);

      // 🔢 עדכן מונה תורות
      callData.turnCount++;

      timings.updateHistory = Date.now() - historyStart;

      // ⏱️  איפוס timeout - יש פעילות
      setupIdleTimeout(callSid);

      // ✅ Mark that processing is done - ready for next user input!
      callData.isProcessing = false; // ✅ Critical: ready to process next input
      // Note: currentAudioPlaying already reset in sendAudioToTwilio block above

      timings.total = Date.now() - timings.start;

      // 📊 Detailed timing breakdown
      console.log(`\n⏱️  TIMING BREAKDOWN:`);
      console.log(`   📦 Prepare payload: ${timings.preparePayload}ms`);
      console.log(`   🌐 n8n processing: ${timings.n8nResponse}ms ⚠️${timings.n8nResponse > 3000 ? ' SLOW!' : ''}`);
      console.log(`   🔄 Audio conversion: ${timings.conversion}ms`);
      console.log(`   📤 Send to Twilio: ${timings.sendToTwilio}ms`);
      console.log(`   📚 Update history: ${timings.updateHistory}ms`);
      console.log(`   ✅ TOTAL: ${timings.total}ms\n`);

      // Update performance stats
      performanceStats.totalCalls++;
      performanceStats.averageN8nTime =
        (performanceStats.averageN8nTime * (performanceStats.totalCalls - 1) + timings.n8nResponse) / performanceStats.totalCalls;
      performanceStats.averageProcessingTime =
        (performanceStats.averageProcessingTime * (performanceStats.totalCalls - 1) + timings.total) / performanceStats.totalCalls;
      performanceStats.averageConversionTime =
        (performanceStats.averageConversionTime * (performanceStats.totalCalls - 1) + timings.conversion) / performanceStats.totalCalls;

      console.log(`📚 History now: ${callData.conversationHistory.length} messages`);
      console.log(`🔧 State: isProcessing=${callData.isProcessing}, currentAudioPlaying=${callData.currentAudioPlaying}, bufferSize=${callData.audioBuffer.length}`);
      console.log('👂 Listening for next user input...\n');
    } else {
      console.error('⚠️  Invalid response from n8n');

      // Reset flags so we can process next input
      callData.isProcessing = false;
      callData.currentAudioPlaying = false; // Just in case

      await sendErrorMessage(callSid, streamSid, ws, 'n8n_error');
    }
  } catch (error) {
    console.error('❌ Error processing audio:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }

    // 🚨 שלח הודעת שגיאה למשתמש
    try {
      await sendErrorMessage(callSid, streamSid, ws, 'general');
    } catch (recoveryError) {
      console.error('❌ Failed to recover from error:', recoveryError.message);
    }

    // ✅ Make sure we can process again even if there was an error
    if (callData) {
      callData.currentAudioPlaying = false;
      callData.isProcessing = false;

      // 📚 רשום שגיאה בהיסטוריה
      callData.conversationHistory.push({
        role: 'system',
        content: 'Error occurred during processing',
        timestamp: Date.now(),
        error: error.message
      });
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
