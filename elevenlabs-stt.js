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
   * Transcribe audio buffer to Hebrew text
   *
   * @param {Buffer} audioBuffer - WAV audio buffer
   * @param {string} language - Language code (default: 'he' for Hebrew)
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(audioBuffer, language = 'he') {
    try {
      const startTime = Date.now();

      // Create form data
      const form = new FormData();
      form.append('audio', audioBuffer, {
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
