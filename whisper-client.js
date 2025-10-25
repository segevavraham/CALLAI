// OpenAI Whisper API Client for Speech-to-Text
// Converts audio (μ-law from Twilio) to Hebrew text

const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

class WhisperClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openai.com/v1/audio/transcriptions';
  }

  /**
   * Transcribe audio to text
   * @param {Buffer} audioBuffer - Audio data (μ-law, 8kHz from Twilio)
   * @param {String} language - Language code (default: 'he' for Hebrew)
   * @returns {Promise<String>} - Transcribed text
   */
  async transcribe(audioBuffer, language = 'he') {
    try {
      console.log(`🎤 Transcribing ${audioBuffer.length} bytes of audio...`);

      // Create form data
      const formData = new FormData();

      // Convert buffer to readable stream
      const audioStream = Readable.from(audioBuffer);

      // Add audio file to form
      formData.append('file', audioStream, {
        filename: 'audio.wav',
        contentType: 'audio/wav'
      });

      formData.append('model', 'whisper-1');
      formData.append('language', language);
      formData.append('response_format', 'json');

      // Make request
      const response = await axios.post(this.baseUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 30000 // 30s timeout
      });

      const text = response.data.text;
      console.log(`📝 Transcribed: "${text}"`);

      return text;
    } catch (error) {
      console.error('❌ Whisper transcription error:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Convert Twilio μ-law audio chunks to WAV format for Whisper
   * @param {Array<String>} base64Chunks - Array of base64 μ-law chunks
   * @returns {Buffer} - WAV audio buffer
   */
  convertMulawToWav(base64Chunks) {
    console.log(`🔄 Converting ${base64Chunks.length} μ-law chunks to WAV...`);

    // Debug: sample chunk sizes
    if (base64Chunks.length > 0) {
      const sampleSizes = base64Chunks.slice(0, 5).map(c => c.length);
      console.log(`   🔍 Sample chunk sizes (base64): ${sampleSizes.join(', ')} characters`);
    }

    // Combine all chunks
    const mulawBase64 = base64Chunks.join('');
    console.log(`   🔗 Combined base64: ${mulawBase64.length} characters`);

    const mulawBuffer = Buffer.from(mulawBase64, 'base64');

    console.log(`   📊 Raw μ-law data: ${mulawBuffer.length} bytes`);
    console.log(`   ⏱️  Duration: ~${(mulawBuffer.length / 8000).toFixed(2)}s at 8kHz`);

    // Validate minimum duration
    if (mulawBuffer.length < 800) { // 0.1s at 8kHz
      console.warn(`   ⚠️  WARNING: Audio too short (${mulawBuffer.length} bytes, need 800+)`);
    }

    // Create WAV header for μ-law (G.711)
    const wavHeader = this.createWavHeader(mulawBuffer.length, 8000, 1, 7); // format 7 = μ-law

    // Combine header + data
    const wavBuffer = Buffer.concat([wavHeader, mulawBuffer]);

    console.log(`   ✅ WAV created: ${wavBuffer.length} bytes (${wavHeader.length} header + ${mulawBuffer.length} data)`);

    return wavBuffer;
  }

  /**
   * Create WAV file header
   */
  createWavHeader(dataLength, sampleRate, channels, audioFormat) {
    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(audioFormat, 20); // audio format (7 = μ-law)
    header.writeUInt16LE(channels, 22); // number of channels
    header.writeUInt32LE(sampleRate, 24); // sample rate
    header.writeUInt32LE(sampleRate * channels, 28); // byte rate
    header.writeUInt16LE(channels, 32); // block align
    header.writeUInt16LE(8, 34); // bits per sample

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
  }
}

module.exports = WhisperClient;
