/**
 * ElevenLabs Speech-to-Text Client
 *
 * Handles Hebrew transcription using ElevenLabs STT API
 * More accurate for Hebrew than Whisper
 */

const FormData = require('form-data');

class ElevenLabsSTT {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.elevenlabs.io/v1/speech-to-text';
  }

  /**
   * Create a valid WAV file from PCM data
   * @param {Buffer} pcmData - Raw PCM audio data (16-bit linear)
   * @param {number} sampleRate - Sample rate (default: 8000 for Twilio)
   * @returns {Buffer} Valid WAV file buffer
   */
  createWavFile(pcmData, sampleRate = 8000) {
    const numChannels = 1; // Mono
    const bitsPerSample = 16; // 16-bit PCM
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize; // 44 bytes header - 8 + data size

    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    // Combine header and PCM data
    return Buffer.concat([header, pcmData]);
  }

  /**
   * Transcribe audio buffer to Hebrew text
   *
   * @param {Buffer} audioBuffer - Raw PCM audio buffer (will be converted to WAV)
   * @param {string} language - Language code (default: 'he' for Hebrew)
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(audioBuffer, language = 'he') {
    try {
      const startTime = Date.now();

      // Create valid WAV file from PCM data
      const wavBuffer = this.createWavFile(audioBuffer);

      // Create form data
      const form = new FormData();
      form.append('audio', wavBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav'
      });
      form.append('language', language);

      // Make API request
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          ...form.getHeaders()
        },
        body: form
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs STT API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const duration = Date.now() - startTime;

      // Extract transcribed text
      const text = result.text || '';

      console.log(`✅ ElevenLabs STT: ${duration}ms`);
      if (text) {
        console.log(`   📝 Transcribed: "${text}"`);
      } else {
        console.log(`   ⚠️  Empty transcription (silence or unclear audio)`);
      }

      return text;

    } catch (error) {
      console.error('❌ ElevenLabs STT error:', error.message);

      // Fallback: return empty string instead of throwing
      // This allows conversation to continue even if STT fails
      return '';
    }
  }

  /**
   * Check if ElevenLabs STT is configured
   */
  static isConfigured() {
    return !!process.env.ELEVENLABS_API_KEY;
  }
}

module.exports = ElevenLabsSTT;
