// Conversation Pipeline: Whisper → GPT-4 → ElevenLabs
// Handles real-time voice conversation with Hebrew TTS
// NOW WITH GPT-4 STREAMING for faster responses!

const WhisperClient = require('./whisper-client');
const GPT4StreamingClient = require('./gpt4-streaming');
const { ElevenLabsHTTP, ElevenLabsClient } = require('./elevenlabs-client');
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
    this.elevenlabsHTTP = new ElevenLabsHTTP(config.elevenLabsApiKey, config.elevenLabsVoiceId);
    this.elevenLabsVoiceId = config.elevenLabsVoiceId;
    this.elevenLabsApiKey = config.elevenLabsApiKey;

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
    this.MAX_BUFFER_SIZE = 400; // force processing after this many chunks (fallback)

    // Statistics
    this.stats = {
      turns: 0,
      startTime: Date.now(),
      transcriptions: 0,
      responses: 0
    };

    console.log(`🌉 Conversation Pipeline initialized for ${callSid}`);
    console.log(`   🎤 STT: Whisper`);
    console.log(`   🤖 LLM: GPT-4 (streaming)`);
    console.log(`   🎵 TTS: ElevenLabs v3 WebSocket (streaming)`);
    console.log(`   🎙️  Voice: ${config.elevenLabsVoiceId}`);
  }

  /**
   * Initialize pipeline
   */
  async initialize() {
    console.log('✅ Pipeline ready - STREAMING MODE');
    console.log('   ⚡ Real-time: GPT-4 → ElevenLabs WebSocket → Twilio');

    // Log call started
    this.n8nLogger.logCallStarted(this.callSid, this.streamSid);

    return true;
  }

  /**
   * Check if audio chunk contains speech (amplitude detection)
   */
  hasSignificantAudio(base64Audio) {
    try {
      const audioBuffer = Buffer.from(base64Audio, 'base64');

      // Calculate RMS (Root Mean Square) amplitude
      let sum = 0;
      for (let i = 0; i < audioBuffer.length; i++) {
        const sample = audioBuffer[i];
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / audioBuffer.length);

      // Threshold for speech detection (adjust if needed)
      const SPEECH_THRESHOLD = 15; // μ-law typically has higher values for speech

      // Log RMS value occasionally for debugging
      if (this.audioBuffer.length % 100 === 0) {
        console.log(`🔊 Audio RMS: ${rms.toFixed(2)} (threshold: ${SPEECH_THRESHOLD})`);
      }

      return rms > SPEECH_THRESHOLD;
    } catch (error) {
      // If can't decode, assume it has audio
      return true;
    }
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

    // Force processing if buffer too large (fallback safety)
    if (this.audioBuffer.length >= this.MAX_BUFFER_SIZE) {
      console.log(`⚠️  Buffer reached ${this.MAX_BUFFER_SIZE} chunks - forcing processing`);
      if (this.silenceTimeout) {
        clearTimeout(this.silenceTimeout);
      }
      await this.processBufferedAudio();
      return;
    }

    // Check if this chunk has significant audio (speech detection)
    const hasSpeech = this.hasSignificantAudio(audioPayload);

    if (hasSpeech) {
      // Reset silence timeout (user is still speaking)
      if (this.silenceTimeout) {
        clearTimeout(this.silenceTimeout);
      }

      // Only start timeout if we have minimum chunks
      if (this.audioBuffer.length >= this.MIN_AUDIO_CHUNKS) {
        // Set new timeout - process audio after silence
        this.silenceTimeout = setTimeout(async () => {
          console.log(`⏱️  Silence detected after speech - processing ${this.audioBuffer.length} chunks`);
          await this.processBufferedAudio();
        }, this.SILENCE_TIMEOUT);
      }

      // Log when first speech detected
      if (this.audioBuffer.length === 1) {
        console.log(`🎤 Speech detected - collecting audio (need ${this.MIN_AUDIO_CHUNKS} chunks)...`);
      }
    }
    // If no speech detected, don't reset timeout - let silence timer expire

    // Log buffer status every 50 chunks
    if (this.audioBuffer.length % 50 === 0 && this.audioBuffer.length > 0) {
      console.log(`📊 Audio buffer: ${this.audioBuffer.length} chunks (speech: ${hasSpeech ? 'yes' : 'no'})`);
    }
  }

  /**
   * Process buffered audio through pipeline with STREAMING
   * GPT-4 streams → ElevenLabs WebSocket → Twilio (real-time!)
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
      gpt4FirstToken: 0,
      gpt4Total: 0,
      elevenLabsFirstChunk: 0,
      elevenLabsTotal: 0,
      total: 0
    };

    let elevenLabsClient = null;

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

      // Step 2: Initialize ElevenLabs WebSocket for streaming
      console.log('🔌 Connecting to ElevenLabs WebSocket...');
      const ElevenLabsClient = require('./elevenlabs-client').ElevenLabsClient;
      elevenLabsClient = new ElevenLabsClient(this.elevenLabsApiKey, this.elevenLabsVoiceId);

      await elevenLabsClient.connect();

      // Prepare to stream audio to Twilio
      let audioChunksReceived = 0;
      let firstChunkTime = null;
      const mp3Chunks = [];

      // Set up ElevenLabs audio streaming
      elevenLabsClient.on('audio', (mp3Chunk) => {
        audioChunksReceived++;

        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          timings.elevenLabsFirstChunk = firstChunkTime - timings.start;
          console.log(`🎵 First audio chunk received (${timings.elevenLabsFirstChunk}ms from start)`);
        }

        // Collect MP3 chunks for batch conversion
        mp3Chunks.push(mp3Chunk);
      });

      let streamComplete = false;
      elevenLabsClient.on('complete', () => {
        streamComplete = true;
        console.log(`✅ ElevenLabs streaming complete (${audioChunksReceived} chunks)`);
      });

      // Step 3: Stream GPT-4 response to ElevenLabs
      const gpt4Start = Date.now();
      let aiText = '';
      let firstTokenTime = null;

      console.log('🤖 Starting GPT-4 streaming...');

      // Set up GPT-4 token streaming
      this.gpt4.on('token', (token) => {
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
          timings.gpt4FirstToken = firstTokenTime - gpt4Start;
          console.log(`⚡ First GPT-4 token (${timings.gpt4FirstToken}ms)`);
        }

        aiText += token;

        // Stream token to ElevenLabs
        elevenLabsClient.sendText(token);
      });

      // Generate streaming response
      await this.gpt4.generateResponse(userText);
      timings.gpt4Total = Date.now() - gpt4Start;

      // Signal ElevenLabs that text is complete
      elevenLabsClient.finishInput();

      if (!aiText || aiText.trim().length === 0) {
        console.log('⚠️  No GPT-4 response');
        elevenLabsClient.close();
        this.isProcessing = false;
        return;
      }

      this.stats.responses++;
      console.log(`🤖 AI: "${aiText}" (${timings.gpt4Total}ms total)`);

      // Log to n8n
      this.n8nLogger.logAITranscript(this.callSid, aiText, this.stats.turns + 1);

      // Wait for all audio chunks
      console.log('⏳ Waiting for all audio chunks...');
      const maxWait = 10000; // 10 seconds max
      const waitStart = Date.now();

      while (!streamComplete && (Date.now() - waitStart < maxWait)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      timings.elevenLabsTotal = Date.now() - gpt4Start;

      if (mp3Chunks.length === 0) {
        console.log('⚠️  No audio received from ElevenLabs');
        elevenLabsClient.close();
        this.isProcessing = false;
        return;
      }

      // Combine all MP3 chunks
      const fullMp3Buffer = Buffer.concat(mp3Chunks);
      console.log(`🎵 Received ${fullMp3Buffer.length} bytes of audio in ${audioChunksReceived} chunks`);

      // Step 4: Convert MP3 to μ-law for Twilio
      const conversionStart = Date.now();
      const mulawBuffer = await this.convertMp3ToMulaw(fullMp3Buffer);
      const conversionTime = Date.now() - conversionStart;

      console.log(`🔄 Converted to μ-law: ${mulawBuffer.length} bytes (${conversionTime}ms)`);

      // Step 5: Send to Twilio
      this.isSpeaking = true;
      await this.sendAudioToTwilio(mulawBuffer);
      this.isSpeaking = false;

      // Close ElevenLabs connection
      elevenLabsClient.close();

      // Update stats
      this.stats.turns++;
      timings.total = Date.now() - timings.start;

      // Log timings
      console.log(`\n⏱️  STREAMING TIMING BREAKDOWN:`);
      console.log(`   🎤 Whisper STT: ${timings.whisper}ms`);
      console.log(`   ⚡ GPT-4 first token: ${timings.gpt4FirstToken}ms`);
      console.log(`   🤖 GPT-4 total: ${timings.gpt4Total}ms`);
      console.log(`   🎵 ElevenLabs first chunk: ${timings.elevenLabsFirstChunk}ms`);
      console.log(`   🎵 ElevenLabs total: ${timings.elevenLabsTotal}ms`);
      console.log(`   🔄 Audio conversion: ${conversionTime}ms`);
      console.log(`   ✅ TOTAL: ${timings.total}ms\n`);

      // Log turn completed to n8n
      this.n8nLogger.logTurnCompleted(this.callSid, this.stats.turns, userText, aiText);

    } catch (error) {
      console.error('❌ Pipeline error:', error.message);
      this.n8nLogger.logError(this.callSid, error, 'conversation_pipeline');

      // Close ElevenLabs connection if open
      if (elevenLabsClient) {
        elevenLabsClient.close();
      }

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
      const mp3Buffer = await this.elevenlabsHTTP.textToSpeech(errorText);
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
