/**
 * ElevenLabs Speech-to-Text Client
 *
 * Handles Hebrew transcription using ElevenLabs STT API
 * More accurate for Hebrew than Whisper
 */

const FormData = require('form-data');
const { spawn } = require('child_process');
const WhisperClient = require('./whisper-client');

class ElevenLabsSTT {
  constructor(apiKey, openaiApiKey = null) {
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.elevenlabs.io/v1/speech-to-text';

    // Whisper fallback (if OpenAI API key provided)
    this.whisper = openaiApiKey ? new WhisperClient(openaiApiKey) : null;
    this.failureCount = 0;
    this.USE_WHISPER_AFTER_FAILURES = 2; // Switch to Whisper after N consecutive failures
  }

  /**
   * Convert μ-law audio to PCM WAV using ffmpeg
   * Twilio sends μ-law (8-bit, 8kHz) but ElevenLabs needs PCM WAV
   *
   * @param {Buffer} mulawBuffer - Raw μ-law audio data from Twilio
   * @returns {Promise<Buffer>} PCM WAV file buffer
   */
  async convertMulawToWav(mulawBuffer) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'mulaw',        // Input format: μ-law
        '-ar', '8000',        // Sample rate: 8000 Hz (Twilio)
        '-ac', '1',           // Channels: 1 (mono)
        '-i', 'pipe:0',       // Input from stdin
        '-f', 'wav',          // Output format: WAV
        '-ar', '16000',       // Upsample to 16kHz for better STT quality
        '-ac', '1',           // Keep mono
        '-acodec', 'pcm_s16le', // PCM 16-bit little-endian
        'pipe:1'              // Output to stdout
      ]);

      const chunks = [];

      ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
      ffmpeg.stderr.on('data', () => {}); // Ignore ffmpeg logs

      ffmpeg.on('close', code => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
      ffmpeg.stdin.write(mulawBuffer);
      ffmpeg.stdin.end();
    });
  }

  /**
   * Transcribe audio buffer to Hebrew text
   *
   * @param {Buffer} audioBuffer - Raw μ-law audio buffer from Twilio
   * @param {string} language - Language code (default: 'he' for Hebrew)
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(audioBuffer, language = 'he') {
    try {
      const startTime = Date.now();

      console.log(`🎤 ElevenLabs STT: Converting ${audioBuffer.length} bytes of μ-law audio...`);

      // Convert μ-law to PCM WAV
      const wavBuffer = await this.convertMulawToWav(audioBuffer);

      console.log(`   ✅ Converted to ${wavBuffer.length} bytes WAV (16kHz PCM)`);

      // Create form data
      const form = new FormData();
      form.append('audio', wavBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav'
      });
      form.append('language', language);

      console.log(`   📤 Sending to ElevenLabs STT API...`);

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
      this.failureCount++;

      // Try Whisper fallback if available
      if (this.whisper && this.failureCount >= this.USE_WHISPER_AFTER_FAILURES) {
        console.log(`   🔄 Switching to Whisper fallback (${this.failureCount} consecutive failures)...`);
        try {
          // Whisper can handle raw μ-law directly
          const text = await this.whisper.transcribe(audioBuffer, 'he');
          this.failureCount = 0; // Reset on success
          return text;
        } catch (whisperError) {
          console.error('❌ Whisper fallback also failed:', whisperError.message);
        }
      }

      // No fallback or all methods failed: return empty string
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
