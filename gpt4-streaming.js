// GPT-4 Streaming Client for real-time conversation
// Streams responses token-by-token for low latency

const axios = require('axios');
const EventEmitter = require('events');

class GPT4StreamingClient extends EventEmitter {
  constructor(apiKey, systemPrompt = null) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openai.com/v1/chat/completions';
    this.conversationHistory = [];
    this.customerName = null; // שם הלקוח
    this.systemPrompt = systemPrompt || this.getDefaultSalesPrompt();
  }

  /**
   * Default sales agent system prompt
   */
  getDefaultSalesPrompt() {
    return `אתה סוכן מכירות ותמיכת לקוחות מקצועי בעברית, שמדבר בטלפון עם לקוחות.

🎯 **אישיות ותפקיד:**
- דובר עברית שוטפת, חברותי ומקצועי
- איש מכירות מנוסה שיודע להקשיב ולזהות צרכים
- מנהל שיחה טבעית ונעימה, לא רובוטית
- תמיד חיובי, אופטימי ועוזר

💬 **סגנון שיחה:**
- תמיד פתח בשיחה: "היי, נעים מאוד! מה שלומך?"
- שאל את שם הלקוח בהתחלה ותשתמש בו לאורך השיחה
- זכור פרטים חשובים שהלקוח מספר (שם, צרכים, העדפות)
- דבר באופן שיחתי וטבעי, לא פורמלי מדי
- ענה בקצרה (1-3 משפטים) - זו שיחת טלפון, לא מסמך
- אל תשתמש ב-"*", bullet points או סימנים מיוחדים - רק טקסט רגיל

🧠 **יכולות:**
- זיהוי צרכים: הקשב מה הלקוח צריך ושאל שאלות מבררות
- זכור מידע: אם הלקוח אמר את שמו/פרטים - זכור ותשתמש בהם
- טיפול בהתנגדויות: אם הלקוח מהסס - תן מענה חיובי ועניני
- הנעה לפעולה: עודד את הלקוח לקבוע פגישה/להמשיך בתהליך

📋 **דוגמאות לשיחה:**
- "היי דני! שמחתי לדבר איתך. מה הדבר העיקרי שאתה מחפש?"
- "מעולה! זה בדיוק מה שאנחנו עושים. ספר לי עוד..."
- "נשמע מעניין! בוא נקבע פגישה קצרה לראות איך אפשר לעזור?"

❌ **אל תעשה:**
- לא להשתמש באמוג'י בתשובות (זו שיחת טלפון)
- לא לכתוב רשימות עם מקפים או כוכביות
- לא להיות יבש או פורמלי מדי
- לא לתת תשובות ארוכות (מקס 3 משפטים)

זכור: אתה מדבר עם אנשים אמיתיים בטלפון. תהיה טבעי, חברותי ואנושי!`;
  }

  /**
   * Set custom system prompt
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.conversationHistory;
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Add user message to history
   */
  addUserMessage(text) {
    this.conversationHistory.push({
      role: 'user',
      content: text
    });
  }

  /**
   * Add assistant message to history
   */
  addAssistantMessage(text) {
    this.conversationHistory.push({
      role: 'assistant',
      content: text
    });
  }

  /**
   * Generate streaming response
   * Emits 'token' events for each token
   * Emits 'complete' event with full text when done
   */
  async generateResponse(userMessage) {
    // Add user message to history
    this.addUserMessage(userMessage);

    // Build messages array
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory
    ];

    console.log(`🤖 Generating GPT-4 response for: "${userMessage}"`);

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'gpt-4o', // Fast, high-quality
          messages: messages,
          temperature: 0.7,
          max_tokens: 150, // Keep responses short for voice
          stream: true
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream',
          timeout: 30000
        }
      );

      let fullText = '';

      // Process stream
      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.includes('[DONE]')) {
              // Stream complete
              console.log(`✅ GPT-4 response complete: "${fullText}"`);
              this.addAssistantMessage(fullText);
              this.emit('complete', fullText);
              resolve(fullText);
              return;
            }

            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.substring(6));
                const delta = json.choices?.[0]?.delta?.content;

                if (delta) {
                  fullText += delta;
                  this.emit('token', delta);
                }
              } catch (error) {
                // Ignore parsing errors for non-JSON lines
              }
            }
          }
        });

        response.data.on('error', (error) => {
          console.error('❌ GPT-4 stream error:', error);
          this.emit('error', error);
          reject(error);
        });

        response.data.on('end', () => {
          if (fullText) {
            console.log(`✅ GPT-4 response complete: "${fullText}"`);
            this.addAssistantMessage(fullText);
            this.emit('complete', fullText);
            resolve(fullText);
          }
        });
      });
    } catch (error) {
      console.error('❌ GPT-4 error:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      }
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Generate non-streaming response (simpler, but higher latency)
   */
  async generateResponseSync(userMessage) {
    this.addUserMessage(userMessage);

    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory
    ];

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'gpt-4o',
          messages: messages,
          temperature: 0.7,
          max_tokens: 150
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const text = response.data.choices[0].message.content;
      console.log(`🤖 GPT-4 response: "${text}"`);
      this.addAssistantMessage(text);

      return text;
    } catch (error) {
      console.error('❌ GPT-4 error:', error.message);
      throw error;
    }
  }
}

module.exports = GPT4StreamingClient;
