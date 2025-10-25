# 🎵 ElevenLabs v3 + Hebrew Voice Integration

## 🎯 Overview

This system uses **ElevenLabs v3** with Alpha model for **natural Hebrew text-to-speech**, delivering authentic Israeli accent and human-like conversation quality.

### Why ElevenLabs Instead of OpenAI Realtime?

| Feature | OpenAI Realtime API | ElevenLabs v3 |
|---------|-------------------|---------------|
| **Hebrew TTS Quality** | ⚠️ American accent, unnatural | ✅ **Native Israeli accent** |
| **Voice Options** | Limited (alloy, echo, shimmer) | ✅ **Extensive Hebrew voices** |
| **Human-like Quality** | Good | ✅ **Exceptional (Alpha model)** |
| **Latency** | < 1s | ~2-3s |
| **Integration** | All-in-one (STT+LLM+TTS) | Manual pipeline |

**Bottom line:** For Israeli customers in production, ElevenLabs is **mandatory** for quality Hebrew speech.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CONVERSATION PIPELINE                  │
└──────────────────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  📞 Twilio Media Stream (μ-law, 8kHz)        │
    │  Receives audio chunks from caller           │
    └───────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  🎤 VAD (Voice Activity Detection)            │
    │  Waits 800ms after user stops speaking       │
    └───────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  🎧 Whisper API (OpenAI)                      │
    │  STT: Audio → Hebrew Text                     │
    │  "שלום, איך אתה?"                            │
    └───────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  🤖 GPT-4 (OpenAI)                            │
    │  Understands + Generates Hebrew Response      │
    │  "שלום! אני בסדר, תודה. במה אוכל לעזור?"    │
    └───────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  🎵 ElevenLabs v3 + Alpha Model               │
    │  TTS: Hebrew Text → Natural Speech (MP3)      │
    │  Voice: exsUS4vynmxd379XN4yO (Israeli accent) │
    └───────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  🔄 ffmpeg Conversion                         │
    │  MP3 → μ-law (8kHz, G.711)                    │
    └───────────────────────────────────────────────┘
                            ↓
    ┌───────────────────────────────────────────────┐
    │  📤 Twilio Media Stream                       │
    │  Sends audio back to caller                   │
    └───────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Step 1: Get ElevenLabs API Key

1. Go to https://elevenlabs.io/
2. Sign up / Log in
3. Navigate to **Settings → API Keys**
4. Create new API key
5. Copy the key

### Step 2: Configure Environment

Edit `.env`:

```bash
# OpenAI Configuration (for Whisper + GPT-4)
OPENAI_API_KEY=your_openai_api_key_here

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=exsUS4vynmxd379XN4yO

# Server
PORT=3000

# n8n (Optional)
N8N_WEBHOOK_URL=https://your-n8n-instance.app.n8n.cloud/webhook/twilio-analytics
```

### Step 3: Install Dependencies

```bash
npm install
```

Dependencies:
- `express` - Web server
- `ws` - WebSocket for Twilio
- `axios` - HTTP requests
- `form-data` - Whisper API file upload
- `dotenv` - Environment variables

### Step 4: Install ffmpeg (Required)

ElevenLabs returns MP3, but Twilio requires μ-law. ffmpeg handles the conversion.

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Railway/Render:** Add to nixpacks.toml:
```toml
[phases.setup]
nixPkgs = ["ffmpeg"]
```

### Step 5: Run Server

```bash
npm start
```

You should see:
```
🚀 Server running on port 3000
🎯 Twilio ⟷ Whisper + GPT-4 + ElevenLabs v3 Pipeline

✅ Pipeline Components:
   🎤 Whisper API - Speech-to-Text (Hebrew)
   🤖 GPT-4 - Conversation AI
   🎵 ElevenLabs v3 - Natural Hebrew TTS
   📊 n8n Analytics - Enabled

🎙️  Voice Settings:
   Voice ID: exsUS4vynmxd379XN4yO
   Model: eleven_turbo_v2_5 (v3 with Hebrew)
   Style: Alpha (most human-like)
```

---

## 🎙️ Voice Configuration

### Current Voice: `exsUS4vynmxd379XN4yO`

This is a **Hebrew voice** with Israeli accent. Configured for natural conversation.

### Change Voice

1. **List available voices:**

```javascript
const { ElevenLabsHTTP } = require('./elevenlabs-client');
const client = new ElevenLabsHTTP(process.env.ELEVENLABS_API_KEY);
const voices = await client.getVoices();
console.log(voices);
```

2. **Update `.env`:**

```bash
ELEVENLABS_VOICE_ID=new_voice_id_here
```

3. **Restart server**

### Voice Settings (in elevenlabs-client.js)

```javascript
voice_settings: {
  stability: 0.5,        // Lower = more expressive (0.0-1.0)
  similarity_boost: 0.8, // Higher = closer to original voice (0.0-1.0)
  style: 0.5,            // Alpha model style (0.0-1.0)
  use_speaker_boost: true // Enhance clarity
}
```

**Adjust for different styles:**
- **More expressive**: `stability: 0.3`
- **More consistent**: `stability: 0.7`
- **More natural**: `style: 0.7`

---

## ⏱️ Performance & Latency

### Expected Timing Breakdown

```
User stops speaking
    ↓
800ms - VAD silence timeout
    ↓
500-1000ms - Whisper STT
    ↓
1000-2000ms - GPT-4 response
    ↓
500-1500ms - ElevenLabs TTS
    ↓
100-300ms - Audio conversion
    ↓
= 2900-5600ms total (~3-5 seconds)
```

### Optimization Tips

1. **Reduce VAD timeout** (conversation-pipeline.js:34):
   ```javascript
   this.SILENCE_TIMEOUT = 600; // 600ms instead of 800ms
   ```

2. **Use GPT-4 streaming** (currently sync):
   - Implement in gpt4-streaming.js
   - Stream text to ElevenLabs in real-time

3. **Pre-generate common responses**:
   - Cache MP3 for "שלום", "תודה", etc.

4. **Use ElevenLabs WebSocket** (elevenlabs-client.js):
   - Stream text as it arrives from GPT-4
   - Lower latency for long responses

---

## 💰 Costs

### Per 5-minute Call

| Component | Usage | Cost |
|-----------|-------|------|
| **Whisper** | ~5 min audio | $0.30 |
| **GPT-4** | ~10 turns × 50 tokens | $0.05 |
| **ElevenLabs** | ~500 characters TTS | $0.75 |
| **Total** | | **~$1.10** |

### ElevenLabs Pricing

- **Starter**: 30,000 characters/month (~60 calls)
- **Creator**: 100,000 characters/month (~200 calls)
- **Pro**: 500,000 characters/month (~1000 calls)

Check pricing: https://elevenlabs.io/pricing

---

## 📁 File Structure

```
.
├── server.js                    # Main server + Twilio WebSocket
├── conversation-pipeline.js     # Orchestrates Whisper → GPT-4 → ElevenLabs
├── whisper-client.js            # OpenAI Whisper STT client
├── gpt4-streaming.js            # GPT-4 conversation client
├── elevenlabs-client.js         # ElevenLabs TTS client (HTTP + WebSocket)
├── n8n-logger.js                # Optional analytics logging
├── package.json                 # Dependencies
├── .env                         # Configuration (API keys)
└── ELEVENLABS_SETUP.md          # This file
```

---

## 🔍 Troubleshooting

### Error: "ELEVENLABS_API_KEY environment variable is required"

**Solution:** Add your ElevenLabs API key to `.env`

### Error: "ffmpeg not found" or conversion fails

**Solution:** Install ffmpeg:
```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt-get install ffmpeg
```

### Poor audio quality / robotic voice

**Solutions:**
1. Check you're using the correct voice ID
2. Adjust voice settings (elevenlabs-client.js:44):
   ```javascript
   stability: 0.4,  // More natural
   style: 0.6       // More expressive
   ```
3. Ensure ffmpeg conversion is working correctly

### High latency (>5s)

**Causes:**
1. Slow internet connection
2. GPT-4 taking long to respond
3. ElevenLabs API slow

**Solutions:**
1. Reduce SILENCE_TIMEOUT (conversation-pipeline.js:34)
2. Use shorter GPT-4 responses (gpt4-streaming.js:15):
   ```javascript
   max_tokens: 100  // Instead of 150
   ```
3. Check ElevenLabs API status

### No audio playing / User can't hear response

**Check logs for:**
1. `✅ ElevenLabs generated X bytes` - TTS succeeded
2. `✅ Converted to μ-law: X bytes` - Conversion succeeded
3. `📤 Sending X chunks to Twilio` - Sending succeeded

**If any missing:**
- Review error logs
- Check API keys
- Verify ffmpeg installation

---

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 123.45,
  "activeCalls": 1,
  "timestamp": "2025-10-25T...",
  "mode": "Whisper + GPT-4 + ElevenLabs v3",
  "voiceId": "exsUS4vynmxd379XN4yO"
}
```

### Call Statistics

```bash
curl http://localhost:3000/stats
```

Response:
```json
{
  "activeCalls": 1,
  "calls": [
    {
      "callSid": "CA123...",
      "duration": 120,
      "turns": 5,
      "transcriptions": 5,
      "responses": 5,
      "conversationHistory": [...]
    }
  ]
}
```

### Logs

Watch for key events:
```
🎤 Processing 234 audio chunks (Turn 1)
📝 User: "שלום, איך אתה?"
🤖 AI: "שלום! אני בסדר, תודה."
🎵 ElevenLabs generated 45678 bytes
🔄 Converted to μ-law: 23456 bytes
📤 Sending 195 chunks to Twilio
✅ Audio sent to Twilio

⏱️  TIMING BREAKDOWN:
   🎤 Whisper STT: 823ms
   🤖 GPT-4: 1456ms
   🎵 ElevenLabs TTS: 987ms
   🔄 Audio conversion: 145ms
   ✅ TOTAL: 3411ms
```

---

## 🎯 Next Steps

1. **Get ElevenLabs API key** and add to `.env`
2. **Install ffmpeg** on your system
3. **Test with a call** to your Twilio number
4. **Fine-tune voice settings** for your use case
5. **Optimize latency** if needed
6. **Add n8n analytics** for insights

---

## 📚 Resources

- [ElevenLabs API Docs](https://elevenlabs.io/docs/api-reference)
- [Whisper API Docs](https://platform.openai.com/docs/guides/speech-to-text)
- [GPT-4 API Docs](https://platform.openai.com/docs/guides/text-generation)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams)
- [N8N Integration Guide](./N8N_INTEGRATION.md)

---

**Need help?** Check logs, review this guide, or open an issue on GitHub.

**מוכן לדבר עברית טבעי! 🇮🇱🎙️**
