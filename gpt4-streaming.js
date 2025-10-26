// GPT-4 Streaming Client for real-time conversation
// Streams responses token-by-token for low latency

const axios = require('axios');
const EventEmitter = require('events');
const { CONVERSATION_STAGES } = require('./conversation-flow');

class GPT4StreamingClient extends EventEmitter {
  constructor(apiKey, systemPrompt = null) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openai.com/v1/chat/completions';
    this.conversationHistory = [];
    this.systemPrompt = systemPrompt || this.getDefaultSalesPrompt();

    // Agent identity
    this.agentName = process.env.AGENT_NAME || 'דני';
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
   * Generate dynamic system prompt based on conversation memory
   * This creates a contextual prompt that adapts to the current stage
   *
   * @param {Object} memory - ConversationMemory instance
   * @returns {string} Dynamic system prompt
   */
  generateSystemPrompt(memory) {
    const stage = CONVERSATION_STAGES[memory.currentStage];
    const context = memory.getContextForPrompt();

    // Format recent messages for context
    const recentConversation = context.recentMessages
      .map(m => `   ${m.role === 'agent' ? '🤖 ' + this.agentName : '👤 לקוח'}: ${m.text}`)
      .join('\n');

    // Sentiment emoji
    const sentimentEmoji = {
      positive: '😊',
      neutral: '😐',
      negative: '😞'
    }[context.sentiment] || '😐';

    const prompt = `
אתה ${this.agentName}, סוכן מכירות מקצועי ומנוסה בעברית. אתה מדבר עברית שוטפת וטבעית.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 מידע על השיחה הנוכחית:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 לקוח:
   ${context.customerName ? `- שם: ${context.customerName} (❗ השתמש בשם בכל תגובה שנייה)` : '- שם: טרם נאסף (❗ עדיפות גבוהה לאסוף!)'}
   - רגש כללי: ${sentimentEmoji} ${context.sentiment === 'positive' ? 'חיובי' : context.sentiment === 'negative' ? 'שלילי' : 'ניטרלי'}

📝 צרכים שזוהו:
   ${context.needs.length > 0 ? context.needs.map((n, i) => `${i + 1}. ${n}`).join('\n   ') : '❌ עדיין לא זוהו צרכים - זו עדיפות!'}

⚠️  התנגדויות שהועלו:
   ${context.objections.length > 0 ? context.objections.map((o, i) => `${i + 1}. ${o}`).join('\n   ') : '✅ אין התנגדויות'}

⭐ נקודות עניין:
   ${context.interests.length > 0 ? context.interests.map((int, i) => `${i + 1}. ${int}`).join('\n   ') : 'אין עדיין'}

💬 היסטוריית שיחה אחרונה (3 חילופים אחרונים):
${recentConversation || '   (התחלת שיחה)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 השלב הנוכחי: ${stage.name} (תור ${context.stageTurnCount}/${stage.maxTurns || '∞'})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 המטרה שלך עכשיו:
   ${stage.agentGoal}

💡 מה עליך לעשות:
   ${stage.agentAction}

⏭️  מה אני מצפה מהלקוח:
   ${stage.expectedCustomerInput}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 כללי התנהגות (CRITICAL - קרא בעיון!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ חובה:
1. **קצר וממוקד**: 1-2 משפטים בלבד! זו שיחת טלפון, לא מסמך.
2. **שאלה אחת**: שאל שאלה אחת בכל תגובה (לא יותר!).
3. **שימוש בשם**: ${context.customerName ? `תשתמש בשם "${context.customerName}" באופן טבעי` : 'אסוף את שם הלקוח בהקדם!'}.
4. **טבעי**: דבר כמו בן אדם - לא רובוטי, לא פורמלי מדי.
5. **טקסט נקי**: ללא *, #, bullet points, או סימנים מיוחדים.
6. **רלוונטיות**: ענה רק לפי מה שהלקוח אמר עכשיו.
7. **זכור**: השתמש במידע שאספת (צרכים, התנגדויות, נקודות עניין).
8. **הקשב**: אם הלקוח אמר משהו חשוב - התייחס לזה!

❌ אסור:
1. תגובות ארוכות (מעל 3 משפטים)
2. מספר שאלות בבת אחת
3. להתעלם ממה שהלקוח אמר
4. תשובות גנריות שלא קשורות לשיחה
5. להשתמש במונחים טכניים מסובכים
6. להשתמש באמוג'י בתשובות

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ דוגמאות לתגובות טובות מול גרועות
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

לקוח: "אני מחפש משהו שיעזור לי לחסוך כסף"

❌ גרוע:
"תודה על השיתוף! אנחנו מציעים מגוון פתרונות שיכולים לעזור לך לחסוך כסף. יש לנו מספר אופציות שונות, כולל תוכניות חיסכון, ייעוץ פיננסי, ועוד. מה מתאים לך יותר?"

✅ מצוין:
"הבנתי שחיסכון חשוב לך. ספר לי, מדובר על חיסכון חודשי או לקראת מטרה מסוימת?"

---

לקוח: "זה נשמע יקר"

❌ גרוע:
"אני מבין את החשש שלך. המחיר שלנו משקף את האיכות הגבוהה של המוצר. בנוסף, יש לנו מבצעים והנחות שיכולים לעזור."

✅ מצוין:
"${context.customerName ? context.customerName + ', ' : ''}אני מבין. מה הטווח תקציבי שנוח לך?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 עכשיו תורך!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ענה ללקוח בהתאם להנחיות לעיל. זכור:
- קצר (1-2 משפטים)
- טבעי ורלוונטי
- שאלה אחת
${context.customerName ? `- השתמש בשם "${context.customerName}"` : ''}
${stage.priority === 'critical' ? '\n⚠️  שלב זה קריטי - הצלחה כאן תקבע את כל השיחה!' : ''}
`;

    return prompt.trim();
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
   * Generate streaming response with conversation memory context
   * Emits 'token' events for each token
   * Emits 'complete' event with full text when done
   *
   * @param {string} userMessage - User's message
   * @param {Object} memory - ConversationMemory instance (optional)
   */
  async generateResponse(userMessage, memory = null) {
    // Add user message to history
    this.addUserMessage(userMessage);

    // Build system prompt (dynamic if memory provided, otherwise default)
    const systemPrompt = memory ? this.generateSystemPrompt(memory) : this.systemPrompt;

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory
    ];

    console.log(`🤖 Generating GPT-4 response for: "${userMessage}"`);
    if (memory) {
      console.log(`   🎯 Stage: ${memory.currentStage} | Turn: ${memory.stageTurnCount}`);
    }

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
