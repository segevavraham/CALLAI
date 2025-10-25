// Conversation Pipeline: Whisper → GPT-4 → ElevenLabs
// Handles real-time voice conversation with Hebrew TTS

const WhisperClient = require('./whisper-client');
const GPT4StreamingClient = require('./gpt4-streaming');
const { ElevenLabsHTTP } = require('./elevenlabs-client');
const N8nLogger = require('./n8n-logger');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class ConversationPipeline {
  constructor(twilioWs, callSid, streamSid, config) {
    this.twilioWs = twilioWs;
    this.callSid = callSid;
    this.streamSid = streamSid;

    // Initialize clients
    this.whisper = new WhisperClient(config.openaiApiKey);
    this.gpt4 = new GPT4StreamingClient(config.openaiApiKey);
    this.elevenlabs = new ElevenLabsHTTP(config.elevenLabsApiKey, config.elevenLabsVoiceId);

    // n8n logger
    this.n8nLogger = new N8nLogger(config.n8nWebhookUrl);

    // Audio buffer for VAD
    this.audioBuffer = [];
    this.isProcessing = false;
    this.isSpeaking = false;
    this.silenceTimeout = null;

    // Configuration
    this.SILENCE_TIMEOUT = 800; // ms - how long to wait after user stops speaking
    this.MIN_AUDIO_CHUNKS = 10; // minimum chunks before processing

    // Statistics
    this.stats = {
      turns: 0,
      startTime: Date.now(),
      transcriptions: 0,
      responses: 0
    };

    console.log(`🌉 Conversation Pipeline initialized for ${callSid}`);
  }

  /**
   * Initialize pipeline
   */
  async initialize() {
    console.log('✅ Pipeline ready (Whisper + GPT-4 + ElevenLabs v3)');

    // Log call started
    this.n8nLogger.logCallStarted(this.callSid, this.streamSid);

    return true;
  }

  /**
   * Handle incoming audio from Twilio
   */
  async handleAudio(audioPayload) {
    // If AI is speaking, ignore user audio
    if (this.isSpeaking) {
      return;
    }

    // Buffer audio
    this.audioBuffer.push(audioPayload);

    // Reset silence timeout (user is still speaking)
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    // Set new timeout - process audio after silence
    this.silenceTimeout = setTimeout(async () => {
      await this.processBufferedAudio();
    }, this.SILENCE_TIMEOUT);

    // Log buffer status every 50 chunks
    if (this.audioBuffer.length % 50 === 0 && this.audioBuffer.length > 0) {
      console.log(`📊 Audio buffer: ${this.audioBuffer.length} chunks`);
    }
  }

  /**
   * Process buffered audio through pipeline
   */
  async processBufferedAudio() {
    if (this.isProcessing || this.audioBuffer.length < this.MIN_AUDIO_CHUNKS) {
      if (this.audioBuffer.length > 0 && this.audioBuffer.length < this.MIN_AUDIO_CHUNKS) {
        console.log(`⏭️  Skipping - only ${this.audioBuffer.length} chunks (need ${this.MIN_AUDIO_CHUNKS})`);
        this.audioBuffer = [];
      }
      return;
    }

    this.isProcessing = true;
    const chunks = [...this.audioBuffer];
    this.audioBuffer = [];

    console.log(`\n🎤 Processing ${chunks.length} audio chunks (Turn ${this.stats.turns + 1})`);

    const timings = {
      start: Date.now(),
      whisper: 0,
      gpt4: 0,
      elevenlabs: 0,
      conversion: 0,
      total: 0
    };

    try {
      // Step 1: Whisper STT
      const whisperStart = Date.now();
      const wavBuffer = this.whisper.convertMulawToWav(chunks);
      const userText = await this.whisper.transcribe(wavBuffer, 'he');
      timings.whisper = Date.now() - whisperStart;

      if (!userText || userText.trim().length === 0) {
        console.log('⏭️  No speech detected, skipping');
        this.isProcessing = false;
        return;
      }

      this.stats.transcriptions++;
      console.log(`📝 User: "${userText}" (${timings.whisper}ms)`);

      // Log to n8n
      this.n8nLogger.logUserTranscript(this.callSid, userText, this.stats.turns + 1);

      // Step 2: GPT-4 Response (sync for now - can optimize with streaming later)
      const gpt4Start = Date.now();
      const aiText = await this.gpt4.generateResponseSync(userText);
      timings.gpt4 = Date.now() - gpt4Start;

      if (!aiText || aiText.trim().length === 0) {
        console.log('⚠️  No GPT-4 response');
        this.isProcessing = false;
        return;
      }

      this.stats.responses++;
      console.log(`🤖 AI: "${aiText}" (${timings.gpt4}ms)`);

      // Log to n8n
      this.n8nLogger.logAITranscript(this.callSid, aiText, this.stats.turns + 1);

      // Step 3: ElevenLabs TTS
      const elevenLabsStart = Date.now();
      const mp3Buffer = await this.elevenlabs.textToSpeech(aiText);
      timings.elevenlabs = Date.now() - elevenLabsStart;

      console.log(`🎤 ElevenLabs generated ${mp3Buffer.length} bytes (${timings.elevenlabs}ms)`);

      // Step 4: Convert MP3 to μ-law for Twilio
      const conversionStart = Date.now();
      const mulawBuffer = await this.convertMp3ToMulaw(mp3Buffer);
      timings.conversion = Date.now() - conversionStart;

      console.log(`🔄 Converted to μ-law: ${mulawBuffer.length} bytes (${timings.conversion}ms)`);

      // Step 5: Send to Twilio
      this.isSpeaking = true;
      await this.sendAudioToTwilio(mulawBuffer);
      this.isSpeaking = false;

      // Update stats
      this.stats.turns++;
      timings.total = Date.now() - timings.start;

      // Log timings
      console.log(`\n⏱️  TIMING BREAKDOWN:`);
      console.log(`   🎤 Whisper STT: ${timings.whisper}ms`);
      console.log(`   🤖 GPT-4: ${timings.gpt4}ms`);
      console.log(`   🎵 ElevenLabs TTS: ${timings.elevenlabs}ms`);
      console.log(`   🔄 Audio conversion: ${timings.conversion}ms`);
      console.log(`   ✅ TOTAL: ${timings.total}ms\n`);

      // Log turn completed to n8n
      this.n8nLogger.logTurnCompleted(this.callSid, this.stats.turns, userText, aiText);

    } catch (error) {
      console.error('❌ Pipeline error:', error.message);
      this.n8nLogger.logError(this.callSid, error, 'conversation_pipeline');

      // Send error message to user
      await this.sendErrorMessage();
    } finally {
      this.isProcessing = false;
      this.isSpeaking = false;
    }
  }

  /**
   * Convert MP3 to μ-law using ffmpeg
   */
  async convertMp3ToMulaw(mp3Buffer) {
    const tempDir = '/tmp';
    const timestamp = Date.now();
    const mp3Path = path.join(tempDir, `audio_${timestamp}.mp3`);
    const mulawPath = path.join(tempDir, `audio_${timestamp}.ulaw`);

    try {
      // Write MP3 to temp file
      await fs.writeFile(mp3Path, mp3Buffer);

      // Convert using ffmpeg
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', mp3Path,
          '-ar', '8000',
          '-ac', '1',
          '-f', 'mulaw',
          mulawPath,
          '-y'
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

      // Read μ-law file
      const mulawBuffer = await fs.readFile(mulawPath);

      // Cleanup
      await fs.unlink(mp3Path).catch(() => {});
      await fs.unlink(mulawPath).catch(() => {});

      return mulawBuffer;
    } catch (error) {
      await fs.unlink(mp3Path).catch(() => {});
      await fs.unlink(mulawPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Send audio to Twilio
   */
  async sendAudioToTwilio(mulawBuffer) {
    const mulawBase64 = mulawBuffer.toString('base64');
    const CHUNK_SIZE = 160;

    console.log(`📤 Sending ${Math.ceil(mulawBase64.length / CHUNK_SIZE)} chunks to Twilio`);

    for (let i = 0; i < mulawBase64.length; i += CHUNK_SIZE) {
      const chunk = mulawBase64.substr(i, CHUNK_SIZE);

      this.twilioWs.send(JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: chunk
        }
      }));

      // Small delay to avoid overwhelming Twilio
      if (i % (CHUNK_SIZE * 10) === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    console.log('✅ Audio sent to Twilio');
  }

  /**
   * Send error message to user
   */
  async sendErrorMessage() {
    try {
      const errorText = 'סליחה, נתקלתי בבעיה טכנית. אנא נסה שוב.';
      const mp3Buffer = await this.elevenlabs.textToSpeech(errorText);
      const mulawBuffer = await this.convertMp3ToMulaw(mp3Buffer);
      await this.sendAudioToTwilio(mulawBuffer);
    } catch (error) {
      console.error('❌ Failed to send error message:', error.message);
    }
  }

  /**
   * Get call statistics
   */
  getStats() {
    const duration = Math.round((Date.now() - this.stats.startTime) / 1000);
    return {
      callSid: this.callSid,
      duration,
      turns: this.stats.turns,
      transcriptions: this.stats.transcriptions,
      responses: this.stats.responses,
      conversationHistory: this.gpt4.getHistory()
    };
  }

  /**
   * Close pipeline
   */
  close() {
    console.log(`📞 Closing pipeline for ${this.callSid}`);

    // Clear timeouts
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    // Log call ended
    const stats = this.getStats();
    console.log(`📊 Final Stats:`);
    console.log(`   ⏱️  Duration: ${stats.duration}s`);
    console.log(`   🔢 Turns: ${stats.turns}`);
    console.log(`   📝 Transcriptions: ${stats.transcriptions}`);
    console.log(`   🤖 Responses: ${stats.responses}`);

    this.n8nLogger.logConversation(this.callSid, stats.conversationHistory, stats);
    this.n8nLogger.logCallEnded(this.callSid, stats);
  }
}

module.exports = ConversationPipeline;
