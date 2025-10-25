// Audio Bridge - Connects Twilio Media Streams with OpenAI Realtime API
// Handles bidirectional audio streaming and event coordination

const OpenAIRealtimeConnection = require('./openai-realtime');
const N8nLogger = require('./n8n-logger');

class AudioBridge {
  constructor(twilioWs, callSid, streamSid, n8nWebhookUrl = null) {
    this.twilioWs = twilioWs;
    this.callSid = callSid;
    this.streamSid = streamSid;
    this.openai = null;

    // n8n Analytics Logger (optional)
    this.n8nLogger = new N8nLogger(n8nWebhookUrl);

    // State tracking
    this.isAISpeaking = false;
    this.isUserSpeaking = false;
    this.audioBuffer = [];

    // Conversation tracking
    this.conversationHistory = [];
    this.turnCount = 0;
    this.startTime = Date.now();
    this.currentUserText = null;
    this.currentAIText = null;

    // Statistics
    this.stats = {
      audioChunksSent: 0,
      audioChunksReceived: 0,
      transcriptionsReceived: 0,
      responsesGenerated: 0
    };
  }

  /**
   * Initialize the bridge and connect to OpenAI
   */
  async initialize(apiKey) {
    try {
      console.log(`🌉 Initializing Audio Bridge for call ${this.callSid}`);

      // Create OpenAI connection
      this.openai = new OpenAIRealtimeConnection(apiKey);

      // Set up event handlers
      this.setupEventHandlers();

      // Connect to OpenAI
      await this.openai.connect();

      console.log(`✅ Audio Bridge ready for call ${this.callSid}`);

      // Log call started to n8n
      this.n8nLogger.logCallStarted(this.callSid, this.streamSid);

      return true;
    } catch (error) {
      console.error(`❌ Failed to initialize Audio Bridge:`, error.message);
      throw error;
    }
  }

  /**
   * Set up event handlers for OpenAI events
   */
  setupEventHandlers() {
    // User transcript received
    this.openai.on('transcript', (data) => {
      this.stats.transcriptionsReceived++;
      this.currentUserText = data.text; // Store for turn completion
      this.conversationHistory.push({
        role: 'user',
        content: data.text,
        timestamp: data.timestamp
      });
      console.log(`📝 User said: "${data.text}"`);

      // Log to n8n
      this.n8nLogger.logUserTranscript(this.callSid, data.text, this.turnCount + 1);
    });

    // AI response audio streaming
    this.openai.on('response.audio.delta', (audioBase64) => {
      this.sendAudioToTwilio(audioBase64);
    });

    // AI response text completed
    this.openai.on('response.text.done', (text) => {
      this.currentAIText = text; // Store for turn completion
      this.conversationHistory.push({
        role: 'assistant',
        content: text,
        timestamp: Date.now()
      });
      console.log(`🤖 AI said: "${text}"`);

      // Log to n8n
      this.n8nLogger.logAITranscript(this.callSid, text, this.turnCount + 1);
    });

    // AI started speaking
    this.openai.on('response.audio.delta', () => {
      if (!this.isAISpeaking) {
        this.isAISpeaking = true;
        console.log('🔊 AI started speaking');
      }
    });

    // AI finished speaking
    this.openai.on('response.audio.done', () => {
      this.isAISpeaking = false;
      this.stats.responsesGenerated++;
      this.turnCount++;
      console.log('🔊 AI finished speaking');
    });

    // User speech detection
    this.openai.on('speech.started', () => {
      this.isUserSpeaking = true;
      console.log('🎤 User started speaking');

      // If AI is speaking, cancel it (user interruption)
      if (this.isAISpeaking) {
        console.log('⚠️  User interrupted AI - canceling response');
        this.openai.cancelResponse();
        this.isAISpeaking = false;
      }
    });

    this.openai.on('speech.stopped', () => {
      this.isUserSpeaking = false;
      console.log('🎤 User stopped speaking');
    });

    // Response completed
    this.openai.on('response.done', () => {
      console.log(`✅ Turn ${this.turnCount} completed`);

      // Log turn completed to n8n
      if (this.currentUserText && this.currentAIText) {
        this.n8nLogger.logTurnCompleted(
          this.callSid,
          this.turnCount,
          this.currentUserText,
          this.currentAIText
        );

        // Reset for next turn
        this.currentUserText = null;
        this.currentAIText = null;
      }
    });

    // Errors
    this.openai.on('error', (error) => {
      console.error('❌ OpenAI error:', error);
      this.sendErrorToTwilio('Sorry, I encountered an error. Please try again.');

      // Log error to n8n
      this.n8nLogger.logError(this.callSid, error, 'OpenAI connection');
    });

    // Connection closed
    this.openai.on('close', () => {
      console.log('🔌 OpenAI connection closed');
    });
  }

  /**
   * Handle audio from Twilio (user speaking)
   */
  async handleTwilioAudio(audioPayload) {
    if (!this.openai || !this.openai.connected) {
      console.warn('⚠️  OpenAI not connected, buffering audio');
      this.audioBuffer.push(audioPayload);
      return;
    }

    // If AI is speaking, ignore user audio to prevent feedback
    if (this.isAISpeaking) {
      return;
    }

    // Send audio to OpenAI
    const sent = this.openai.sendAudio(audioPayload);
    if (sent) {
      this.stats.audioChunksSent++;

      // Log every 50 chunks to avoid spam
      if (this.stats.audioChunksSent % 50 === 0) {
        console.log(`📊 Sent ${this.stats.audioChunksSent} audio chunks to OpenAI`);
      }
    }
  }

  /**
   * Send audio to Twilio (AI speaking)
   */
  sendAudioToTwilio(audioBase64) {
    if (!audioBase64) return;

    this.stats.audioChunksReceived++;

    try {
      // Send audio chunk to Twilio
      this.twilioWs.send(JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioBase64
        }
      }));
    } catch (error) {
      console.error('❌ Error sending audio to Twilio:', error.message);
    }
  }

  /**
   * Send error message to Twilio (synthesized silence or error tone)
   */
  sendErrorToTwilio(message) {
    console.log(`⚠️  Sending error to Twilio: ${message}`);
    // For now, just log. In production, you might want to use TTS or send silence
  }

  /**
   * Get call statistics
   */
  getStats() {
    const duration = Math.round((Date.now() - this.startTime) / 1000);
    return {
      callSid: this.callSid,
      duration,
      turns: this.turnCount,
      conversationLength: this.conversationHistory.length,
      audioChunksSent: this.stats.audioChunksSent,
      audioChunksReceived: this.stats.audioChunksReceived,
      transcriptionsReceived: this.stats.transcriptionsReceived,
      responsesGenerated: this.stats.responsesGenerated
    };
  }

  /**
   * Get conversation history
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Close the bridge and cleanup
   */
  close() {
    console.log(`📞 Closing Audio Bridge for call ${this.callSid}`);

    // Log final stats
    const stats = this.getStats();
    console.log(`📊 Final Stats:`);
    console.log(`   ⏱️  Duration: ${stats.duration}s`);
    console.log(`   🔢 Turns: ${stats.turns}`);
    console.log(`   📚 Messages: ${stats.conversationLength}`);
    console.log(`   📤 Audio chunks sent: ${stats.audioChunksSent}`);
    console.log(`   📥 Audio chunks received: ${stats.audioChunksReceived}`);
    console.log(`   📝 Transcriptions: ${stats.transcriptionsReceived}`);
    console.log(`   🤖 Responses: ${stats.responsesGenerated}`);

    // Send full conversation to n8n
    this.n8nLogger.logConversation(this.callSid, this.conversationHistory, stats);

    // Log call ended to n8n
    this.n8nLogger.logCallEnded(this.callSid, stats);

    // Close OpenAI connection
    if (this.openai) {
      this.openai.close();
      this.openai = null;
    }

    // Clear buffers
    this.audioBuffer = [];
    this.conversationHistory = [];
  }
}

module.exports = AudioBridge;
