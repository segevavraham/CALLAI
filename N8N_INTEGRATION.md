# 📊 n8n Analytics Integration

## סקירה כללית

המערכת תומכת ב-**n8n analytics integration אופציונלי** שמאפשר לך לקבל את כל נתוני השיחה ב-n8n **מבלי להאט את השיחה הקולית**.

### איך זה עובד?

```
┌─────────────────────────────────────────────────────┐
│                    שיחה קולית                        │
│  Twilio ⟷ Server ⟷ OpenAI Realtime API             │
│         (בזמן אמת, מהיר)                             │
└─────────────────────────────────────────────────────┘
                    ↓
                    ↓ (async, לא חוסם)
                    ↓
         ┌──────────────────────┐
         │   n8n Webhook        │
         │   (analytics)        │
         └──────────────────────┘
```

**התוצאה:**
- ✅ שיחה קולית מהירה (< 1s latency)
- ✅ כל המידע נשלח ל-n8n (transcripts, analytics, stats)
- ✅ אפס השפעה על performance

---

## ⚙️ הגדרה

### שלב 1: הגדר את ה-webhook ב-.env

```bash
N8N_WEBHOOK_URL=https://segevavraham.app.n8n.cloud/webhook/twilio-analytics
```

אם המשתנה לא מוגדר - המערכת פשוט לא תשלח ל-n8n (אבל השיחה תעבוד).

### שלב 2: צור workflow ב-n8n

צור workflow חדש ב-n8n עם **Webhook node**:

1. פתח n8n
2. צור workflow חדש
3. הוסף "Webhook" node
4. הגדר:
   - **Method**: POST
   - **Path**: `twilio-analytics`
   - **Respond**: Immediately

---

## 📨 Events שנשלחים ל-n8n

### 1. `call.started` - שיחה התחילה

```json
{
  "eventType": "call.started",
  "timestamp": "2025-10-25T12:34:56.789Z",
  "callSid": "CA1234567890abcdef",
  "streamSid": "MZ1234567890abcdef"
}
```

**שימוש:** התחל tracking של השיחה, שלח notification, וכו'

---

### 2. `transcript.user` - משתמש דיבר

```json
{
  "eventType": "transcript.user",
  "timestamp": "2025-10-25T12:35:01.234Z",
  "callSid": "CA1234567890abcdef",
  "transcript": "שלום, איך אתה?",
  "turnNumber": 1,
  "role": "user"
}
```

**שימוש:** שמור transcripts, נתח sentiment, וכו'

---

### 3. `transcript.ai` - AI ענה

```json
{
  "eventType": "transcript.ai",
  "timestamp": "2025-10-25T12:35:03.456Z",
  "callSid": "CA1234567890abcdef",
  "transcript": "שלום! אני בסדר, תודה. במה אוכל לעזור?",
  "turnNumber": 1,
  "role": "assistant"
}
```

**שימוש:** שמור תשובות AI, בדוק איכות, וכו'

---

### 4. `turn.completed` - תור הסתיים

```json
{
  "eventType": "turn.completed",
  "timestamp": "2025-10-25T12:35:05.789Z",
  "callSid": "CA1234567890abcdef",
  "turnNumber": 1,
  "userText": "שלום, איך אתה?",
  "aiText": "שלום! אני בסדר, תודה. במה אוכל לעזור?"
}
```

**שימוש:** נתח conversation flow, בדוק relevance, וכו'

---

### 5. `error` - שגיאה

```json
{
  "eventType": "error",
  "timestamp": "2025-10-25T12:35:10.123Z",
  "callSid": "CA1234567890abcdef",
  "error": "Connection timeout",
  "stack": "Error: Connection timeout\n  at ...",
  "context": "OpenAI connection"
}
```

**שימוש:** שלח alerts, לוג שגיאות, וכו'

---

### 6. `call.ended` - שיחה הסתיימה

```json
{
  "eventType": "call.ended",
  "timestamp": "2025-10-25T12:40:00.000Z",
  "callSid": "CA1234567890abcdef",
  "duration": 300,
  "turns": 8,
  "conversationLength": 16,
  "audioChunksSent": 450,
  "audioChunksReceived": 320,
  "transcriptionsReceived": 8,
  "responsesGenerated": 8
}
```

**שימוש:** סטטיסטיקות כלליות, billing, reports

---

### 7. `conversation.complete` - שיחה מלאה

```json
{
  "eventType": "conversation.complete",
  "timestamp": "2025-10-25T12:40:00.100Z",
  "callSid": "CA1234567890abcdef",
  "conversationHistory": [
    {
      "role": "user",
      "content": "שלום, איך אתה?",
      "timestamp": 1729860901234
    },
    {
      "role": "assistant",
      "content": "שלום! אני בסדר, תודה.",
      "timestamp": 1729860903456
    }
    // ... כל השיחה
  ],
  "stats": {
    "duration": 300,
    "turns": 8,
    "conversationLength": 16
    // ... סטטיסטיקות
  }
}
```

**שימוש:** שמור שיחה מלאה למסד נתונים, ניתוח מעמיק, training data

---

## 🎯 דוגמאות שימוש ב-n8n

### דוגמה 1: שמור ל-Google Sheets

```
Webhook → Google Sheets
  ↓
שמור כל transcript לגיליון
```

### דוגמה 2: התראות על שגיאות

```
Webhook → Filter (eventType = "error") → Slack
  ↓
שלח הודעה לערוץ Slack כשיש שגיאה
```

### דוגמה 3: CRM Integration

```
Webhook → Filter (eventType = "conversation.complete")
  ↓
Airtable / Notion / Salesforce
  ↓
שמור שיחה מלאה ל-CRM
```

### דוגמה 4: ניתוח Sentiment

```
Webhook → Filter (eventType = "transcript.user")
  ↓
HTTP Request → OpenAI Sentiment Analysis
  ↓
Google Sheets (sentiment scores)
```

### דוגמה 5: Real-time Dashboard

```
Webhook → Redis / Database
  ↓
Grafana / Dashboard
  ↓
תצוגה בזמן אמת של שיחות פעילות
```

---

## 🛠️ n8n Workflow Template

העתק את ה-JSON הזה ל-n8n:

```json
{
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "twilio-analytics",
        "responseMode": "immediately"
      },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "position": [250, 300]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{ $json.eventType }}",
              "operation": "equals",
              "value2": "transcript.user"
            }
          ]
        }
      },
      "name": "Filter - User Transcripts",
      "type": "n8n-nodes-base.if",
      "position": [450, 200]
    },
    {
      "parameters": {
        "authentication": "oAuth2",
        "operation": "append",
        "spreadsheetId": "YOUR_SHEET_ID",
        "range": "Sheet1!A:E",
        "options": {}
      },
      "name": "Google Sheets - Save Transcript",
      "type": "n8n-nodes-base.googleSheets",
      "position": [650, 200]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          {
            "node": "Filter - User Transcripts",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Filter - User Transcripts": {
      "main": [
        [
          {
            "node": "Google Sheets - Save Transcript",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

---

## 🔍 בדיקה

### 1. בדוק אם n8n מקבל events:

```bash
# הרץ שיחת בדיקה
# בדוק ב-n8n Executions שהאירועים מגיעים
```

### 2. בדוק logs בשרת:

```
📊 n8n Analytics enabled: https://segevavraham.app.n8n.cloud/webhook/twilio-analytics
```

אם אתה רואה את זה - n8n מופעל ✅

אם אתה רואה:
```
📊 n8n Analytics disabled (no webhook URL)
```

זה אומר ש-N8N_WEBHOOK_URL לא מוגדר.

---

## ⚠️ חשוב!

### 1. Fire-and-Forget
כל ה-events נשלחים **async** - אם n8n down, השיחה תמשיך לעבוד!

### 2. Timeout
יש timeout של 5 שניות לכל request ל-n8n. אם n8n לא עונה - המערכת ממשיכה.

### 3. Silent Failures
שגיאות ב-n8n לא מוצגות למשתמש - רק ב-logs:
```
⚠️  n8n logging failed (transcript.user): timeout of 5000ms exceeded
```

### 4. אבטחה
ודא ש-n8n webhook מוגדר לקבל רק מהשרת שלך (IP whitelist).

---

## 📊 מה אפשר לעשות עם הנתונים?

1. **Analytics Dashboard**
   - כמה שיחות ביום
   - average duration
   - most common questions

2. **Quality Monitoring**
   - sentiment analysis
   - AI response quality
   - user satisfaction

3. **Business Intelligence**
   - conversion tracking
   - customer insights
   - product feedback

4. **Automation**
   - send follow-up emails
   - create support tickets
   - update CRM

5. **Training Data**
   - improve AI responses
   - build FAQ
   - identify common issues

---

## 🚀 Next Steps

1. צור n8n workflow
2. הגדר N8N_WEBHOOK_URL ב-.env
3. הרץ שיחת בדיקה
4. בדוק ב-n8n שהאירועים מגיעים
5. בנה את ה-analytics שאתה צריך!

**Need help?** פתח issue ב-GitHub או בדוק את הלוגים.
