# 🔍 מדריך דיבאג - למה השיחה לא עובדת טוב

## תאריך: 2025-10-23

---

## 🎯 **המטרה: שיחה טבעית ואיכותית**

המשתמש דיווח:
- ✅ המערכת ענתה מדי פעם
- ❌ לא שמע אותי בפועל
- ❌ לא שיחה טבעית
- ❌ לא איכותי

---

## 📊 **מה צריך לבדוק בלוגים:**

### **1. האם Audio נאסף?**

חפש בלוגים:
```
📊 Collecting audio: 20 chunks (need 15) | Processing: false | Speaking: false
📊 Collecting audio: 40 chunks (need 15) | Processing: false | Speaking: false
```

**אם לא רואה את זה:** Twilio לא שולח audio → בעיית WebSocket

---

### **2. האם Audio מעובד?**

חפש:
```
🎤 Processing 35 audio chunks (Turn 2)
   ⏱️  Audio duration: ~700ms
   🔧 Initial state: isProcessing=true, speaking=false
```

**אם לא רואה את זה:** VAD לא מזהה שקט או MIN_CHUNKS גבוה מדי

---

### **3. האם n8n מגיב?**

חפש:
```
📥 n8n responded in 8500ms
```

**אם רואה:**
- `< 3000ms` = מהיר ✅
- `3000-6000ms` = בינוני ⚠️
- `> 6000ms` = איטי מדי ❌

**אם לא רואה בכלל:** n8n לא מגיב → בעיה ב-webhook

---

### **4. האם יש שגיאות?**

חפש:
```
❌ Error processing audio
❌ Error sending audio to Twilio
❌ Conversion error
```

---

## 🐛 **בעיות נפוצות ופתרונות:**

### **בעיה A: "רואה Collecting audio אבל לא Processing"**

**סיבה:** Audio נאסף אבל לא מגיע ל-MIN_CHUNKS לפני שהמשתמש שותק.

**פתרון:**
```javascript
// הורד את MIN_CHUNKS
const MIN_AUDIO_CHUNKS = 10; // במקום 15
```

---

### **בעיה B: "רואה Processing אבל לא תשובה"**

**סיבה 1:** n8n לא מגיב

**בדוק:**
- האם יש `📥 n8n responded`?
- האם יש שגיאה `❌ Error processing audio`?

**פתרון:**
- בדוק שn8n webhook עובד
- בדוק credentials של OpenAI/ElevenLabs

---

**סיבה 2:** n8n מגיב אבל אין audio

**בדוק:**
- האם `response.data.success = true`?
- האם `response.data.audio` קיים?
- האם `response.data.format = 'mp3'`?

**פתרון:**
- וודא שn8n מחזיר את כל השדות
- בדוק שElevenLabs מחזיר MP3

---

### **בעיה C: "רואה SKIPPED הרבה"**

```
⏭️  SKIPPED - only 8 chunks (need 15)
```

**סיבה:** המשתמש מדבר משפטים קצרים מדי.

**פתרון:**
```javascript
const MIN_AUDIO_CHUNKS = 8; // הורד
const SILENCE_TIMEOUT = 800; // הפחת
```

---

### **בעיה D: "תשובות לא רלוונטיות"**

**סיבה 1:** STT לא מזהה טוב (Whisper בעיתי בעברית)

**פתרון:**
```javascript
// החלף ל-Deepgram
model: 'nova-2'
language: 'he'
```

---

**סיבה 2:** חסר היסטוריה

**בדוק בלוגים:**
```
📚 History: 0 messages  ← רע!
📚 History: 4 messages  ← טוב!
```

**פתרון:**
- וודא ש-conversationHistory נשלח לn8n
- וודא שn8n משתמש בהיסטוריה

---

**סיבה 3:** System prompt לא טוב

**פתרון:**
```
"אתה עוזר בעברית. עונה בצורה קצרה וטבעית, עד 2 משפטים.
היה ידידותי ומקצועי. שאל שאלות כדי להבין טוב יותר."
```

---

### **בעיה E: "עיכובים ארוכים (5+ שניות)"**

**סיבה:** n8n איטי

**בדוק timing breakdown:**
```
⏱️  TIMING BREAKDOWN:
   🌐 n8n processing: 8500ms ⚠️ SLOW!
```

**פתרון:** ראה `N8N_OPTIMIZATION_GUIDE.md`:
1. החלף ל-Deepgram STT (חיסכון 1.5s)
2. השתמש ב-GPT-3.5 במקום GPT-4 (חיסכון 4s)
3. השתמש ב-ElevenLabs Turbo (חיסכון 1.5s)

---

## 📋 **Checklist לדיבאג:**

### **לוגים:**
- [ ] רואה `📊 Collecting audio`?
- [ ] רואה `🎤 Processing audio chunks`?
- [ ] רואה `📥 n8n responded`?
- [ ] כמה זמן n8n לוקח? (< 4s = טוב)
- [ ] רואה `🔊 Audio sent successfully`?
- [ ] רואה `👂 Listening for next user input`?

### **שגיאות:**
- [ ] אין `❌ Error` בלוגים?
- [ ] אין `⏭️  SKIPPED` הרבה?
- [ ] אין `⏸️  Already processing` כל הזמן?

### **n8n:**
- [ ] webhook עובד? (curl test)
- [ ] מחזיר `success: true`?
- [ ] מחזיר `audio` + `format: 'mp3'`?
- [ ] מחזיר `text` + `userText`? (optional אבל מומלץ)

### **איכות:**
- [ ] STT מזהה עברית טוב?
- [ ] LLM עונה ברלוונטיות?
- [ ] TTS נשמע טבעי?
- [ ] יש היסטוריה בשיחה?

---

## 🎯 **מה לשלוח למפתח (אני):**

### **1. לוגים מ-Railway** (הכי חשוב!)

העתק את **כל הלוגים** מהשיחה האחרונה, במיוחד:
```
📞 Call started: CAxxxx
...
📊 Collecting audio: ...
...
🎤 Processing audio chunks
...
⏱️  TIMING BREAKDOWN
...
👂 Listening for next user input
```

### **2. תוצאות של בדיקות:**

```bash
# Health check
curl https://your-app.railway.app/health

# Stats
curl https://your-app.railway.app/stats
```

### **3. פרטים על n8n:**

- איזה STT משתמש? (Whisper? Deepgram? אחר?)
- איזה LLM? (GPT-4? GPT-3.5? Claude?)
- איזה TTS? (ElevenLabs? Azure? אחר?)
- איזה models? (regular? turbo?)

### **4. תיאור מדויק של הבעיה:**

- מה קרה בדיוק בשיחה?
- האם AI ענה בכלל?
- אם כן, מה הוא אמר?
- האם זה היה רלוונטי?
- כמה זמן זה לקח?
- האם זה קרה רק פעם אחת או בכל שיחה?

---

## 💡 **הגדרות נוכחיות:**

```javascript
SILENCE_TIMEOUT = 1000ms     // זמן המתנה לשקט
MIN_AUDIO_CHUNKS = 15        // מינימום chunks
CHUNK_SIZE = 160 bytes       // 20ms per chunk
```

**משמעות:**
- אם משתמש מדבר פחות מ-300ms (15 chunks × 20ms) = SKIPPED
- אחרי שהמשתמש שותק 1000ms = מתחיל לעבד

---

## 🔧 **שינויים שעשינו:**

1. **SILENCE_TIMEOUT: 600ms → 1000ms**
   - יותר זמן למשתמש לגמור משפט
   - פחות false positives

2. **MIN_AUDIO_CHUNKS: 8 → 15**
   - מספיק audio לזיהוי טוב
   - פחות רעש

3. **Logging משופר:**
   - רואים בדיוק כמה audio נאסף
   - רואים משך audio במילישניות
   - רואים מדוע דברים נדחו

---

## 🎓 **טיפים לשיחה איכותית:**

### **1. System Prompt טוב:**
```
אתה עוזר שירות לקוחות בעברית של [חברה].
- עונה בצורה קצרה וטבעית (עד 2 משפטים)
- שאל שאלות בירור כדי להבין מה הלקוח צריך
- היה ידידותי אבל מקצועי
- אל תחזור על עצמך
```

### **2. Max tokens נמוך:**
```javascript
max_tokens: 100  // תשובות קצרות = מהיר + טבעי
```

### **3. Temperature מאוזן:**
```javascript
temperature: 0.7  // לא יותר מדי יצירתי
```

### **4. היסטוריה מוגבלת:**
```javascript
conversationHistory.slice(-10)  // רק 10 אחרונות
```

---

**נוצר על ידי: Claude Code**
**תאריך: 2025-10-23**
