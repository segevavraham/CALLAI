// ElevenLabs v3 + Alpha Model Integration
// Provides natural Hebrew TTS with websocket streaming for real-time responses

const WebSocket = require('ws');
const EventEmitter = require('events');

class ElevenLabsClient extends EventEmitter {
  constructor(apiKey, voiceId = 'exsUS4vynmxd379XN4yO') {
    super();
    this.apiKey = apiKey;
    this.voiceId = voiceId; // Hebrew voice
    this.ws = null;
    this.isConnected = false;
  }

  /**
   * Connect to ElevenLabs WebSocket API (Text Streaming → Audio Streaming)
   * Using v3 with Alpha model for most human-like Hebrew speech
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`🎤 Connecting to ElevenLabs v3 (voice: ${this.voiceId})...`);

      // ElevenLabs WebSocket URL for text-to-speech streaming
      const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_v3`;

      this.ws = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      this.ws.on('open', () => {
        console.log('✅ Connected to ElevenLabs v3');
        this.isConnected = true;

        // Send initial configuration with Alpha model settings
        const config = {
          text: ' ',
          voice_settings: {
            stability: 0.5,        // Lower = more expressive
            similarity_boost: 0.8, // Higher = closer to original voice
            style: 0.5,            // Alpha model style
            use_speaker_boost: true
          },
          generation_config: {
            chunk_length_schedule: [120, 160, 250, 290] // Optimized for streaming
          },
          xi_api_key: this.apiKey
        };

        this.ws.send(JSON.stringify(config));
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          this.handleMessage(response);
        } catch (error) {
          // Binary audio data
          this.emit('audio', data);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ ElevenLabs WebSocket error:', error.message);
        this.isConnected = false;
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 ElevenLabs connection closed');
        this.isConnected = false;
        this.emit('close');
      });
    });
  }

  /**
   * Handle incoming messages from ElevenLabs
   */
  handleMessage(message) {
    if (message.audio) {
      // Base64 encoded audio chunk
      const audioBuffer = Buffer.from(message.audio, 'base64');
      this.emit('audio', audioBuffer);
    }

    if (message.isFinal) {
      console.log('✅ ElevenLabs audio generation complete');
      this.emit('complete');
    }

    if (message.normalizedAlignment) {
      // Character-level alignment (for lip-sync, etc.)
      this.emit('alignment', message.normalizedAlignment);
    }
  }

  /**
   * Send text to be converted to speech (streaming)
   * Text is processed in real-time as it arrives
   */
  sendText(text) {
    if (!this.isConnected) {
      console.warn('⚠️  ElevenLabs not connected, buffering text');
      return false;
    }

    const payload = {
      text: text,
      try_trigger_generation: true
    };

    this.ws.send(JSON.stringify(payload));
    return true;
  }

  /**
   * Signal that text input is complete
   */
  finishInput() {
    if (!this.isConnected) {
      return false;
    }

    const payload = {
      text: ''
    };

    this.ws.send(JSON.stringify(payload));
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

/**
 * Alternative: HTTP-based TTS for single requests (non-streaming)
 * Use when you have complete text upfront
 */
class ElevenLabsHTTP {
  constructor(apiKey, voiceId = 'exsUS4vynmxd379XN4yO') {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.baseUrl = 'https://api.elevenlabs.io/v1';
  }

  /**
   * Generate speech from text (complete text, non-streaming)
   * Returns MP3 audio buffer
   */
  async textToSpeech(text) {
    const axios = require('axios');

    const url = `${this.baseUrl}/text-to-speech/${this.voiceId}`;

    const payload = {
      text: text,
      model_id: 'eleven_v3', // v3 with Hebrew support
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.5,
        use_speaker_boost: true
      }
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      return Buffer.from(response.data);
    } catch (error) {
      console.error('❌ ElevenLabs TTS error:', error.message);
      throw error;
    }
  }

  /**
   * Get available voices
   */
  async getVoices() {
    const axios = require('axios');

    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      return response.data.voices;
    } catch (error) {
      console.error('❌ Failed to fetch voices:', error.message);
      throw error;
    }
  }
}

module.exports = {
  ElevenLabsClient,
  ElevenLabsHTTP
};
