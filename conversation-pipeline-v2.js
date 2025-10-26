/**
 * Conversation Pipeline V2 - Enhanced with State Machine & ElevenLabs STT
 *
 * New architecture:
 * - ElevenLabs STT (better Hebrew accuracy than Whisper)
 * - ConversationMemory (tracks customer data, needs, objections)
 * - ConversationFlowManager (state machine for sales methodology)
 * - Dynamic GPT-4 prompts (adapts to conversation stage)
 * - n8n webhook integration (call analytics & follow-ups)
 *
 * Flow: Twilio → ElevenLabs STT → State Machine → GPT-4 → ElevenLabs TTS → Twilio
 */

const WhisperClient = require('./whisper-client');
const GPT4StreamingClient = require('./gpt4-streaming');
const { ElevenLabsHTTP } = require('./elevenlabs-client');
const ConversationMemory = require('./conversation-memory');
const { ConversationFlowManager } = require('./conversation-flow');
const N8NWebhook = require('./n8n-webhook');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class ConversationPipelineV2 {
  constructor(twilioWs, callSid, streamSid, config) {
    this.twilioWs = twilioWs;
    this.callSid = callSid;
    this.streamSid = streamSid;

    // Initialize conversation memory & flow
    this.memory = new ConversationMemory(callSid);
    this.flowManager = new ConversationFlowManager(this.memory);

    // Initialize AI clients
    this.stt = new WhisperClient(config.openaiApiKey); // Use Whisper directly (more reliable)
    this.gpt4 = new GPT4StreamingClient(config.openaiApiKey);
    this.tts = new ElevenLabsHTTP(config.elevenLabsApiKey, config.elevenLabsVoiceId);

    // n8n webhook
    this.n8nWebhook = new N8NWebhook(config.n8nWebhookUrl);

    // Audio buffer for VAD (Voice Activity Detection)
    this.audioBuffer = [];
    this.isProcessing = false;
    this.isSpeaking = false;
    this.silenceTimeout = null;

    // Configuration (optimized for fast, natural response)
    this.SILENCE_TIMEOUT = 400; // ms - how long to wait after user stops speaking (fast response)
    this.MIN_AUDIO_CHUNKS = 10; // minimum chunks before processing
    this.MAX_BUFFER_SIZE = 60; // force processing after this many chunks (~1.2 seconds at 20ms/chunk - faster!)

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🌉 Conversation Pipeline V2 initialized`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📞 Call ID: ${callSid}`);
    console.log(`🎤 STT: Whisper (OpenAI - proven reliable for Hebrew)`);
    console.log(`🤖 LLM: GPT-4 with context-aware prompts`);
    console.log(`🎵 TTS: ElevenLabs v3 (natural Hebrew voice)`);
    console.log(`🎯 State Machine: ENABLED`);
    console.log(`📊 n8n Webhook: ${this.n8nWebhook.enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  /**
   * Initialize pipeline and send greeting
   */
  async initialize() {
    console.log('✅ Pipeline ready - starting conversation...\n');

    // Send greeting message
    await this.sendGreeting();

    return true;
  }

  /**
   * Send greeting message to start the conversation
   */
  async sendGreeting() {
    try {
      console.log('👋 Sending greeting message...');

      // Get greeting from current stage (GREETING stage) - warm and natural
      const greetingText = 'היי! נעים מאוד. איך קוראים לך?';

      // Add to conversation history
      this.memory.addMessage('agent', greetingText);

      // Generate audio
      const mp3Buffer = await this.tts.textToSpeech(greetingText);
      const mulawBuffer = await this.convertMp3ToMulaw(mp3Buffer);

      // Send to Twilio
      this.isSpeaking = true;
      await this.sendAudioToTwilio(mulawBuffer);
      this.isSpeaking = false;

      console.log('✅ Greeting sent successfully\n');
    } catch (error) {
      console.error('❌ Failed to send greeting:', error.message);
    }
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

      // Threshold for speech detection (increased for better accuracy - filters out background noise)
      const SPEECH_THRESHOLD = 50;

      // Log RMS value occasionally for debugging
      if (this.audioBuffer.length % 100 === 0 && this.audioBuffer.length > 0) {
        console.log(`🔊 Audio RMS: ${rms.toFixed(2)} (threshold: ${SPEECH_THRESHOLD})`);
      }

      return rms > SPEECH_THRESHOLD;
    } catch (error) {
      return true; // If can't decode, assume it has audio
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
          console.log(`⏱️  Silence detected - processing ${this.audioBuffer.length} chunks`);
          await this.processBufferedAudio();
        }, this.SILENCE_TIMEOUT);
      }

      // Log when first speech detected
      if (this.audioBuffer.length === 1) {
        console.log(`🎤 Speech detected - collecting audio (need ${this.MIN_AUDIO_CHUNKS} chunks)...`);
      }
    }

    // Log buffer status every 50 chunks
    if (this.audioBuffer.length % 50 === 0 && this.audioBuffer.length > 0) {
      console.log(`📊 Audio buffer: ${this.audioBuffer.length} chunks (speech: ${hasSpeech ? 'yes' : 'no'})`);
    }
  }

  /**
   * Process buffered audio through the full pipeline
   * STT → State Update → GPT-4 → TTS → Twilio
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

    console.log(`\n${'━'.repeat(70)}`);
    console.log(`🎤 PROCESSING TURN ${this.memory.turnCount + 1}`);
    console.log(`   Stage: ${this.memory.currentStage}`);
    console.log(`   Chunks: ${chunks.length}`);
    console.log(`${'━'.repeat(70)}\n`);

    const timings = { start: Date.now(), stt: 0, gpt4: 0, tts: 0, total: 0 };

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 1: Speech-to-Text (Whisper)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const sttStart = Date.now();

      // Convert μ-law chunks to WAV for Whisper
      const wavBuffer = this.stt.convertMulawToWav(chunks);
      const userText = await this.stt.transcribe(wavBuffer, 'he');

      timings.stt = Date.now() - sttStart;

      console.log(`\n${'='.repeat(70)}`);
      console.log(`🎤 USER SAID:`);
      console.log(`   "${userText}"`);
      console.log(`   Length: ${userText ? userText.length : 0} characters`);
      console.log(`   Transcription time: ${timings.stt}ms`);
      console.log(`${'='.repeat(70)}\n`);

      // Handle empty transcription
      if (!userText || userText.trim().length === 0) {
        console.log('⚠️  No speech detected (empty transcription)');
        console.log('   Possible causes:');
        console.log('   1. Background noise/silence');
        console.log('   2. Audio quality too low');
        console.log('   3. Microphone issues\n');
        this.isProcessing = false;
        return;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 2: Update Conversation Memory
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.memory.addMessage('customer', userText);

      // Print current state (for debugging)
      this.memory.printState();

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 3: Check for Stage Transition
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const transitioned = this.flowManager.processTransition(userText);

      if (transitioned) {
        console.log(`   ✅ Stage transition completed`);
        this.memory.printState();
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 4: Generate GPT-4 Response (with dynamic prompt)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const gpt4Start = Date.now();

      console.log('🤖 Generating GPT-4 response...');

      // Generate response with conversation memory context
      const aiText = await this.gpt4.generateResponse(userText, this.memory);

      timings.gpt4 = Date.now() - gpt4Start;

      console.log(`\n${'─'.repeat(70)}`);
      console.log(`🤖 AI RESPONSE:`);
      console.log(`   "${aiText}"`);
      console.log(`   Length: ${aiText.length} characters`);
      console.log(`   Generation time: ${timings.gpt4}ms`);
      console.log(`${'─'.repeat(70)}\n`);

      // Add AI response to memory
      this.memory.addMessage('agent', aiText);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 5: Text-to-Speech (ElevenLabs TTS)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const ttsStart = Date.now();

      console.log('🎵 Generating audio with ElevenLabs...');

      const mp3Buffer = await this.tts.textToSpeech(aiText);
      const mulawBuffer = await this.convertMp3ToMulaw(mp3Buffer);

      timings.tts = Date.now() - ttsStart;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 6: Send Audio to Twilio
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.isSpeaking = true;
      await this.sendAudioToTwilio(mulawBuffer);
      this.isSpeaking = false;

      timings.total = Date.now() - timings.start;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 7: Print Timing Summary
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log(`\n⏱️  TIMING BREAKDOWN:`);
      console.log(`   🎤 STT (ElevenLabs): ${timings.stt}ms`);
      console.log(`   🤖 GPT-4: ${timings.gpt4}ms`);
      console.log(`   🎵 TTS (ElevenLabs): ${timings.tts}ms`);
      console.log(`   ✅ TOTAL: ${timings.total}ms\n`);

      // Check if we reached a final stage
      if (this.flowManager.isFinalStage()) {
        console.log(`\n🏁 Conversation reached final stage: ${this.memory.currentStage}`);
        console.log(`   Outcome: ${this.memory.outcome}`);

        // Send summary to n8n webhook
        await this.n8nWebhook.sendCallSummary(this.memory);
      }

    } catch (error) {
      console.error('\n❌ Error processing audio:', error.message);
      console.error(error.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Convert μ-law chunks to WAV buffer
   * (Same logic as Whisper client but without Whisper dependency)
   */
  convertMulawToWav(base64Chunks) {
    // Remove padding from each chunk before combining
    const chunksWithoutPadding = base64Chunks.map(chunk => chunk.replace(/=+$/, ''));

    // Combine all chunks
    const combinedBase64 = chunksWithoutPadding.join('');

    // Calculate correct padding
    const paddingNeeded = (4 - (combinedBase64.length % 4)) % 4;
    const finalBase64 = combinedBase64 + '='.repeat(paddingNeeded);

    // Decode to buffer
    const mulawBuffer = Buffer.from(finalBase64, 'base64');

    // Create WAV header for μ-law (G.711)
    const wavHeader = this.createWavHeader(mulawBuffer.length, 8000, 1, 7);
    const wavBuffer = Buffer.concat([wavHeader, mulawBuffer]);

    return wavBuffer;
  }

  /**
   * Create WAV header
   */
  createWavHeader(dataLength, sampleRate, numChannels, audioFormat) {
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Sub-chunk size
    header.writeUInt16LE(audioFormat, 20); // Audio format (7 = μ-law)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels, 28); // Byte rate
    header.writeUInt16LE(numChannels, 32); // Block align
    header.writeUInt16LE(8, 34); // Bits per sample

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
  }

  /**
   * Convert MP3 to μ-law using ffmpeg
   */
  async convertMp3ToMulaw(mp3Buffer) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-ar', '8000',
        '-ac', '1',
        '-f', 'mulaw',
        'pipe:1'
      ]);

      const chunks = [];

      ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
      ffmpeg.stdout.on('end', () => resolve(Buffer.concat(chunks)));
      ffmpeg.stderr.on('data', () => {}); // Ignore ffmpeg logs

      ffmpeg.on('error', reject);
      ffmpeg.stdin.write(mp3Buffer);
      ffmpeg.stdin.end();
    });
  }

  /**
   * Send audio to Twilio in base64 chunks
   */
  async sendAudioToTwilio(mulawBuffer) {
    const chunkSize = 160; // Twilio expects 160-byte chunks
    const totalChunks = Math.ceil(mulawBuffer.length / chunkSize);

    console.log(`📤 Sending ${totalChunks} chunks to Twilio`);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = mulawBuffer.slice(i * chunkSize, (i + 1) * chunkSize);
      const base64Chunk = chunk.toString('base64');

      this.twilioWs.send(JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: base64Chunk
        }
      }));

      // Small delay to prevent overwhelming Twilio
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    console.log('✅ Audio sent to Twilio');
  }

  /**
   * Close pipeline and send final summary
   */
  async close() {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📞 Closing pipeline for ${this.callSid}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Print final stats
    const duration = Math.round((Date.now() - this.memory.startTime) / 1000);

    console.log(`📊 Final Stats:`);
    console.log(`   ⏱️  Duration: ${duration}s`);
    console.log(`   🔢 Turns: ${this.memory.turnCount}`);
    console.log(`   👤 Customer: ${this.memory.customer.name || 'Unknown'}`);
    console.log(`   🎯 Outcome: ${this.memory.outcome || 'Incomplete'}`);
    console.log(`   😊 Sentiment: ${this.memory.sentiment}`);
    console.log(`   📝 Needs: ${this.memory.needs.length}`);
    console.log(`   ⚠️  Objections: ${this.memory.objections.length}\n`);

    // Send final summary to n8n (if not already sent)
    if (!this.flowManager.isFinalStage() && this.memory.turnCount > 0) {
      this.memory.outcome = this.memory.outcome || 'INCOMPLETE';
      await this.n8nWebhook.sendCallSummary(this.memory);
    }

    // Print summary
    console.log(`📋 Quick Summary:`);
    console.log(`   ${this.memory.getQuickSummary()}\n`);
  }
}

module.exports = ConversationPipelineV2;
