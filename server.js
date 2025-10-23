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
const SILENCE_TIMEOUT = 800; // 800ms - fast response while avoiding word cuts ⚡
const MIN_AUDIO_CHUNKS = 12; // Minimum chunks - works for short utterances too 🎤
const CHUNK_SIZE = 160; // Twilio standard
const MAX_IDLE_TIME = 30000; // 30 seconds of silence before timeout warning
const CONVERSATION_TIMEOUT = 300000; // 5 minutes total conversation limit
const MAX_HISTORY_MESSAGES = 50; // Maximum messages to keep in history (prevent memory issues)

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
            idleWarningsSent: 0          // ⚠️  Track timeout warnings
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

          if (callData.currentAudioPlaying) {
            // AI is speaking, ignore user input to prevent feedback
            // console.log(`🔇 Ignoring user input - AI speaking`);
            break;
          }

          if (callData.isProcessing) {
            // Already processing previous input, buffer this
            // console.log(`⏸️  Buffering while processing`);
          }

          // ✅ Use callData.audioBuffer instead of local variable
          callData.audioBuffer.push(msg.media.payload);

          // ⚡ Real-time VAD
          clearTimeout(silenceTimeout);
          silenceTimeout = setTimeout(async () => {
            const currentCallData = activeCalls.get(callSid);
            if (!currentCallData) return;

            // Only process if we have enough audio AND not currently processing
            if (currentCallData.audioBuffer.length >= MIN_AUDIO_CHUNKS && !currentCallData.isProcessing) {
              currentCallData.isProcessing = true;
              const chunksToProcess = [...currentCallData.audioBuffer];
              currentCallData.audioBuffer = []; // ✅ Clear buffer for next turn

              console.log(`🎤 Processing ${chunksToProcess.length} audio chunks`);
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

            // 📊 לוג סטטיסטיקות שיחה
            const callDuration = Date.now() - endCallData.startTime;
            console.log(`📊 Call Stats:`);
            console.log(`   ⏱️  Duration: ${Math.round(callDuration / 1000)}s`);
            console.log(`   🔢 Turns: ${endCallData.turnCount}`);
            console.log(`   📚 Messages: ${endCallData.conversationHistory.length}`);
          }
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
    if (callSid) {
      const closeCallData = activeCalls.get(callSid);
      if (closeCallData && closeCallData.idleTimeout) {
        clearTimeout(closeCallData.idleTimeout);
      }
      activeCalls.delete(callSid);
    }
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
  const startTime = Date.now();
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
    console.log(`🎤 Processing audio for ${callSid}`);
    console.log(`   📦 Chunks: ${audioChunks.length}`);
    console.log(`   🔢 Turn: ${callData.turnCount + 1}`);
    console.log(`   ⏱️  Duration: ${Math.round(callDuration / 1000)}s`);
    console.log(`   📚 History: ${callData.conversationHistory.length} messages`);

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

    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
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

      // ✅ Mark that AI is speaking
      callData.currentAudioPlaying = true;

      try {
        await sendAudioToTwilio(ws, streamSid, audioPayload);
      } catch (audioError) {
        console.error('❌ Error sending audio to Twilio:', audioError.message);
        // Continue anyway - we'll reset flags below
      }

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
          processingTime: totalTime
        });
      }

      // 📚 נהל גודל היסטוריה
      manageHistorySize(callData);

      // 🔢 עדכן מונה תורות
      callData.turnCount++;

      // ⏱️  איפוס timeout - יש פעילות
      setupIdleTimeout(callSid);

      // ✅ Mark that AI finished speaking - ready for next user input!
      callData.currentAudioPlaying = false;
      callData.isProcessing = false; // ✅ Critical: ready to process next input

      console.log(`✅ Complete response cycle: ${Date.now() - startTime}ms`);
      console.log(`   📚 History now: ${callData.conversationHistory.length} messages`);
      console.log('👂 Listening for next user input...');
    } else {
      console.error('⚠️  Invalid response from n8n');

      // Reset flags so we can process next input
      callData.currentAudioPlaying = false;
      callData.isProcessing = false;

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
