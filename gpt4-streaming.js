// GPT-4 Streaming Client for real-time conversation
// Streams responses token-by-token for low latency

const axios = require('axios');
const EventEmitter = require('events');

class GPT4StreamingClient extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openai.com/v1/chat/completions';
    this.conversationHistory = [];
    this.systemPrompt = `אתה עוזר וירטואלי דובר עברית. התנהג באופן טבעי, חברי ומועיל.
ענה בעברית בצורה קצרה וממוקדת (2-3 משפטים מקסימום).
היה שיחתי - כאילו אתה מדבר בטלפון עם אדם.`;
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
