# 🎯 OpenAI Realtime API Integration - Setup Guide

## 📋 Overview

This system now uses **OpenAI Realtime API** for direct voice-to-voice conversations, replacing the previous n8n-based architecture.

### Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Caller    │ ◄─────► │    Twilio    │ ◄─────► │   Your Server   │
│  (Phone)    │  Voice  │   (Media     │   WS    │   (Node.js)     │
│             │         │   Streams)   │         │                 │
└─────────────┘         └──────────────┘         └────────┬────────┘
                                                           │
                                                           │ WS
                                                           ▼
                                                  ┌─────────────────┐
                                                  │   OpenAI        │
                                                  │   Realtime API  │
                                                  │   (GPT-4o)      │
                                                  └─────────────────┘
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `express` - Web server
- `ws` - WebSocket library
- `dotenv` - Environment variable management

### 2. Configure Environment Variables

Edit `.env` file:

```bash
OPENAI_API_KEY=sk-your-actual-openai-api-key-here
PORT=3000
```

**Get your OpenAI API Key:**
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Make sure you have access to `gpt-4o-realtime-preview-2024-10-01` model

### 3. Run the Server

```bash
npm start
```

You should see:
```
🚀 Server running on port 3000
🎯 Twilio ⟷ OpenAI Realtime API Bridge

✅ Features:
   🎤 Real-time voice conversation
   🇮🇱 Hebrew language support
   🔄 Bidirectional audio streaming
   📊 Live transcription and analytics
```

### 4. Configure Twilio

1. Go to your Twilio Console
2. Navigate to your phone number settings
3. Under "Voice & Fax", set:
   - **A call comes in**: Webhook
   - **URL**: `https://your-domain.com/voice`
   - **HTTP Method**: GET

## 📁 File Structure

```
.
├── server.js                   # Main server (Twilio WebSocket handler)
├── openai-realtime.js         # OpenAI Realtime API connection module
├── audio-bridge.js            # Audio bridge (Twilio ↔ OpenAI)
├── package.json               # Dependencies
├── .env                       # Environment variables (do NOT commit!)
└── OPENAI_REALTIME_SETUP.md   # This file
```

## 🔧 How It Works

### Event Flow

```yaml
1. Call Initiated
   - Twilio receives phone call
   - Requests TwiML from /voice endpoint
   - Establishes WebSocket connection to /media-stream

2. Audio Bridge Created
   - Server creates AudioBridge instance
   - AudioBridge connects to OpenAI Realtime API
   - OpenAI session configured (Hebrew, voice: alloy)

3. User Speaks
   - Twilio sends audio chunks (μ-law, 8kHz) via WebSocket
   - AudioBridge forwards audio to OpenAI
   - OpenAI performs real-time STT (Speech-to-Text)

4. AI Processes
   - OpenAI GPT-4o understands the Hebrew text
   - Generates Hebrew response
   - Converts to speech using TTS (Text-to-Speech)

5. AI Responds
   - OpenAI streams audio back to server
   - AudioBridge forwards to Twilio
   - Twilio plays audio to caller

6. Conversation Continues
   - OpenAI's VAD (Voice Activity Detection) automatically detects turns
   - Conversation flows naturally
   - Full history maintained
```

## 🎤 Voice Configuration

The OpenAI session is configured in `openai-realtime.js`:

```javascript
{
  modalities: ['text', 'audio'],
  instructions: 'You are a helpful Hebrew-speaking assistant...',
  voice: 'alloy',                    // Voice model
  input_audio_format: 'g711_ulaw',   // Twilio format
  output_audio_format: 'g711_ulaw',  // Twilio format
  turn_detection: {
    type: 'server_vad',              // Automatic turn detection
    threshold: 0.5,
    silence_duration_ms: 600
  }
}
```

**Available Voices:**
- `alloy` - Neutral, balanced
- `echo` - More masculine
- `shimmer` - More feminine

**To change the voice:** Edit line 87 in `openai-realtime.js`

## 📊 Monitoring & Debugging

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 123.456,
  "activeCalls": 2,
  "timestamp": "2025-10-25T...",
  "mode": "OpenAI Realtime API"
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
      "callSid": "CA1234...",
      "duration": 45,
      "turns": 8,
      "conversationLength": 16,
      "audioChunksSent": 450,
      "audioChunksReceived": 320,
      "transcriptionsReceived": 8,
      "responsesGenerated": 8
    }
  ]
}
```

### Log Output

When a call is active, you'll see logs like:

```
📞 New Twilio call connected
📞 Call started: CA1234567890abcdef
🌉 Initializing Audio Bridge for call CA1234567890abcdef
🔌 Connecting to OpenAI Realtime API...
✅ Connected to OpenAI Realtime API
⚙️  Configuring OpenAI session (Hebrew, voice: alloy)...
✅ Session configured
📝 Session created: sess_xxxxx
✅ Audio Bridge ready for call CA1234567890abcdef
✅ Call CA1234567890abcdef ready - audio streaming active

🎤 User started speaking
📝 User said: "שלום, איך אתה?"
🤖 AI said: "שלום! אני בסדר, תודה. במה אוכל לעזור לך היום?"
🔊 AI started speaking
🔊 AI finished speaking
✅ Turn 1 completed
```

## ❌ Troubleshooting

### Error: "OPENAI_API_KEY environment variable is required"

**Solution:** Make sure `.env` file exists and contains valid API key:
```bash
OPENAI_API_KEY=sk-your-actual-key-here
```

### Error: "Failed to initialize Audio Bridge"

**Possible causes:**
1. Invalid OpenAI API key
2. No access to Realtime API model
3. Network issues

**Check:**
```bash
# Test OpenAI API access
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### No audio / User can't hear AI

**Check:**
1. Logs show "Connected to OpenAI Realtime API" ✅
2. Logs show "AI started speaking" ✅
3. Logs show "Sending audio to Twilio" ✅

**If missing any of above:**
- Check OpenAI connection
- Check Twilio WebSocket connection
- Review logs for errors

### User speech not detected

**Check:**
1. OpenAI session configured with `turn_detection` ✅
2. Audio format is `g711_ulaw` ✅
3. Logs show "User started speaking" when user talks ✅

**Adjust VAD sensitivity** in `openai-realtime.js` (line 99):
```javascript
turn_detection: {
  type: 'server_vad',
  threshold: 0.3,  // Lower = more sensitive (0.0 - 1.0)
  silence_duration_ms: 500  // Shorter = faster response
}
```

## 🔐 Security Notes

1. **Never commit `.env` file** - Add to `.gitignore`
2. **Rotate API keys regularly**
3. **Use environment variables** in production
4. **Monitor API usage** - OpenAI Realtime API is metered

## 💰 Costs

OpenAI Realtime API pricing (as of Oct 2024):
- **Audio input**: $0.06 / minute
- **Audio output**: $0.24 / minute
- **Text input/output**: Standard GPT-4o pricing

**Example 5-minute call:**
- Input: 5 min × $0.06 = $0.30
- Output: ~3 min × $0.24 = $0.72
- **Total: ~$1.02 per call**

Monitor costs at: https://platform.openai.com/usage

## 🚀 Deployment

### Railway

1. Push code to GitHub
2. Create new project on Railway
3. Add environment variables:
   - `OPENAI_API_KEY`
4. Deploy

### Render

1. Create new Web Service
2. Connect GitHub repo
3. Set environment variables
4. Deploy

### Railway/Render will automatically:
- Install dependencies (`npm install`)
- Run `npm start`
- Expose HTTPS endpoint

## 📚 Next Steps

1. **Customize AI instructions**: Edit `openai-realtime.js` line 86
2. **Change voice**: Edit `openai-realtime.js` line 87
3. **Add function calling**: See OpenAI Realtime API docs
4. **Store conversations**: Add database integration to `audio-bridge.js`
5. **Add analytics**: Track conversation metrics

## 📖 Resources

- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime)
- [Twilio Media Streams Docs](https://www.twilio.com/docs/voice/media-streams)
- [GitHub Issues](https://github.com/your-repo/issues) - Report bugs here

---

**Need help?** Check logs, review this guide, or open an issue on GitHub.
