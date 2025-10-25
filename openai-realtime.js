// OpenAI Realtime API Connection Module
// Handles WebSocket connection to OpenAI's Realtime API for voice conversations

const WebSocket = require('ws');
const EventEmitter = require('events');

class OpenAIRealtimeConnection extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;
  }

  /**
   * Connect to OpenAI Realtime API
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log('🔌 Connecting to OpenAI Realtime API...');

      this.ws = new WebSocket(
        'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        }
      );

      this.ws.on('open', () => {
        console.log('✅ Connected to OpenAI Realtime API');
        this.isConnected = true;
        this.configureSession();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Error parsing OpenAI message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ OpenAI WebSocket error:', error.message);
        this.isConnected = false;
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 OpenAI WebSocket closed');
        this.isConnected = false;
        this.emit('close');
      });
    });
  }

  /**
   * Configure session with Hebrew voice and settings
   */
  configureSession() {
    console.log('⚙️  Configuring OpenAI session (Hebrew, voice: alloy)...');

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a helpful Hebrew-speaking assistant. Respond naturally in Hebrew. Keep responses concise and conversational.',
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600
        },
        temperature: 0.8,
        max_response_output_tokens: 4096
      }
    };

    this.ws.send(JSON.stringify(sessionConfig));
    console.log('✅ Session configured');
  }

  /**
   * Handle incoming messages from OpenAI
   */
  handleMessage(message) {
    switch (message.type) {
      case 'session.created':
        this.sessionId = message.session.id;
        console.log(`📝 Session created: ${this.sessionId}`);
        this.emit('session.created', message.session);
        break;

      case 'session.updated':
        console.log('✅ Session updated');
        this.emit('session.updated', message.session);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log(`📝 User transcript: "${message.transcript}"`);
        this.emit('transcript', {
          role: 'user',
          text: message.transcript,
          timestamp: Date.now()
        });
        break;

      case 'response.audio_transcript.delta':
        // AI response text (streaming)
        this.emit('response.text.delta', message.delta);
        break;

      case 'response.audio_transcript.done':
        console.log(`🤖 AI transcript: "${message.transcript}"`);
        this.emit('response.text.done', message.transcript);
        break;

      case 'response.audio.delta':
        // AI response audio (streaming) - Base64 encoded μ-law
        this.emit('response.audio.delta', message.delta);
        break;

      case 'response.audio.done':
        console.log('✅ AI audio response completed');
        this.emit('response.audio.done');
        break;

      case 'response.done':
        console.log('✅ Response completed');
        this.emit('response.done', message.response);
        break;

      case 'input_audio_buffer.speech_started':
        console.log('🎤 User started speaking');
        this.emit('speech.started');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 User stopped speaking');
        this.emit('speech.stopped');
        break;

      case 'error':
        console.error('❌ OpenAI error:', message.error);
        this.emit('error', message.error);
        break;

      default:
        // Log other events for debugging
        if (message.type !== 'response.audio.delta') { // Don't spam logs with audio deltas
          console.log(`📨 OpenAI event: ${message.type}`);
        }
        break;
    }
  }

  /**
   * Send audio to OpenAI (Base64 encoded μ-law)
   */
  sendAudio(base64Audio) {
    if (!this.isConnected) {
      console.warn('⚠️  Cannot send audio - not connected to OpenAI');
      return false;
    }

    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    }));

    return true;
  }

  /**
   * Commit the audio buffer (tells OpenAI to process)
   */
  commitAudio() {
    if (!this.isConnected) {
      console.warn('⚠️  Cannot commit audio - not connected to OpenAI');
      return false;
    }

    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.commit'
    }));

    return true;
  }

  /**
   * Create a response (tells OpenAI to generate response)
   */
  createResponse() {
    if (!this.isConnected) {
      console.warn('⚠️  Cannot create response - not connected to OpenAI');
      return false;
    }

    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: 'Please respond in Hebrew.'
      }
    }));

    return true;
  }

  /**
   * Cancel current response (e.g., if user interrupts)
   */
  cancelResponse() {
    if (!this.isConnected) {
      return false;
    }

    this.ws.send(JSON.stringify({
      type: 'response.cancel'
    }));

    return true;
  }

  /**
   * Clear audio buffer
   */
  clearAudioBuffer() {
    if (!this.isConnected) {
      return false;
    }

    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.clear'
    }));

    return true;
  }

  /**
   * Close connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }

  /**
   * Check if connected
   */
  get connected() {
    return this.isConnected;
  }
}

module.exports = OpenAIRealtimeConnection;
