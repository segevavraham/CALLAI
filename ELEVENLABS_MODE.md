# ElevenLabs Integration Modes

## 🎯 Overview

The system supports **two modes** for ElevenLabs TTS integration:

### 1. **HTTP Mode** (Default) ✅ RECOMMENDED
- Uses `eleven_v3` model with full Hebrew support
- Non-streaming: waits for full GPT-4 response before generating audio
- More reliable and stable
- Better quality Hebrew speech

### 2. **WebSocket Mode** (Optional)
- Uses `eleven_turbo_v2_5` model with streaming
- Real-time: starts generating audio as GPT-4 tokens arrive
- Faster time-to-first-audio
- May have slightly lower Hebrew quality

---

## 🔧 How to Switch Modes

### Set in Railway Environment Variables:

**For HTTP Mode (Default):**
```
ELEVENLABS_MODE=http
```
or simply don't set it (defaults to HTTP)

**For WebSocket Mode:**
```
ELEVENLABS_MODE=websocket
```

---

## 📊 Comparison

| Feature | HTTP Mode | WebSocket Mode |
|---------|-----------|----------------|
| **Model** | `eleven_v3` | `eleven_turbo_v2_5` |
| **Hebrew Quality** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐ Good |
| **Streaming** | ❌ No | ✅ Yes |
| **Latency** | ~3-4s | ~2-3s |
| **Reliability** | ✅ Very High | ⚠️  Medium |
| **Setup** | ✅ Works out of box | ⚠️  Requires API support |

---

## 🎵 Models Used

### HTTP Mode:
- **Greeting**: `eleven_v3` (ElevenLabsHTTP)
- **Responses**: `eleven_v3` (ElevenLabsHTTP)

### WebSocket Mode:
- **Greeting**: `eleven_v3` (ElevenLabsHTTP - fallback)
- **Responses**: `eleven_turbo_v2_5` (ElevenLabsClient WebSocket)

---

## 🔍 Logs to Look For

### HTTP Mode:
```
🌉 Conversation Pipeline initialized
   🎵 TTS: ElevenLabs v3 (HTTP mode)

✅ Pipeline ready - HYBRID MODE
   ⚡ GPT-4 streaming → ElevenLabs HTTP (eleven_v3) → Twilio

📡 Using ElevenLabs HTTP API (eleven_v3)...
```

### WebSocket Mode:
```
🌉 Conversation Pipeline initialized
   🎵 TTS: ElevenLabs v3 (WEBSOCKET mode)

✅ Pipeline ready - FULL STREAMING MODE
   ⚡ Real-time: GPT-4 streaming → ElevenLabs WebSocket → Twilio

🔌 Connecting to ElevenLabs WebSocket...
```

---

## ⚠️  Troubleshooting

### If WebSocket gives 403 Error:
```
❌ ElevenLabs WebSocket error: Unexpected server response: 403
```

**Solution:** Switch to HTTP mode:
1. Go to Railway → Environment Variables
2. Set `ELEVENLABS_MODE=http`
3. Redeploy

### If audio quality is poor in WebSocket mode:
**Solution:** Switch to HTTP mode for better Hebrew quality

---

## 💡 Recommendation

**Use HTTP mode** unless you specifically need the fastest possible response time and are willing to sacrifice some Hebrew speech quality.

For production use with Hebrew customers, **HTTP mode with `eleven_v3` is strongly recommended**.
