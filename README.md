# 🎙️ Twilio-n8n WebSocket Bridge with Hebrew TTS

WebSocket bridge that connects Twilio Media Streams to n8n workflows with automatic MP3 to mulaw audio conversion.

## ✨ Features

- ✅ Real-time audio streaming from Twilio to n8n
- ✅ Automatic MP3 to mulaw conversion using ffmpeg
- ✅ Hebrew TTS support via ElevenLabs
- ✅ Welcome message on call start
- ✅ Silence detection and audio buffering

## 🚀 Quick Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [Railway](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway will auto-detect the `nixpacks.toml` and install ffmpeg

### 3. Set Environment Variable

In Railway dashboard, add:
- **Variable:** `N8N_WEBHOOK_URL`
- **Value:** `https://segevavraham.app.n8n.cloud/webhook/twilio-process-audio`

### 4. Get Your Railway URL

After deployment, Railway will give you a URL like:
`https://your-app.railway.app`

### 5. Configure Twilio

In your Twilio Console:
1. Go to Phone Numbers → Active Numbers
2. Select your number
3. Under "Voice & Fax" → "A CALL COMES IN"
4. Select "Webhook"
5. Enter: `https://your-app.railway.app/voice`
6. Select "HTTP GET"
7. Save

## 📋 Files Needed for Deployment

Upload these 3 files to your GitHub repo:

1. **server.js** - Main WebSocket bridge with MP3 conversion
2. **package.json** - Dependencies and nixpacks config
3. **nixpacks.toml** - Railway build configuration with ffmpeg

## 🔧 How It Works

1. **Call Start** → Twilio connects via WebSocket
2. **Welcome** → Server sends Hebrew greeting via n8n/ElevenLabs
3. **User Speaks** → Audio buffered and sent to n8n
4. **n8n Processing**:
   - Whisper STT (Hebrew)
   - AI Agent response
   - ElevenLabs TTS (MP3)
5. **Conversion** → Server converts MP3 to mulaw
6. **Play** → Audio streamed back to caller

## 🎯 n8n Workflow Setup

Your n8n workflow should:
1. Accept webhook POST with `audioData`, `callSid`, `streamSid`
2. Convert audio to text (Whisper)
3. Generate AI response (GPT)
4. Convert to speech (ElevenLabs - MP3 format)
5. Return JSON: `{ success: true, audio: "base64", format: "mp3" }`

## 🐛 Debugging

Check Railway logs:
```
📞 Call started: CAxxxx
🎤 Processing audio for call CAxxxx
🔄 Converting MP3 response to mulaw...
✅ Conversion complete
🔊 Sending audio response to Twilio
✅ Audio sent successfully
```

## 📝 Notes

- ffmpeg is automatically installed via nixpacks.toml
- Conversion happens server-side for every response
- Audio chunks are 160 bytes for Twilio compatibility
- Supports both welcome messages and conversation responses

## 🔗 Related

- n8n workflow ID: `4ApxGn2dpHmhQTPx`
- Webhook URL: `/webhook/twilio-process-audio`
