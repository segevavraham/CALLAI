/**
 * ConversationMemory - Manages conversation state, customer data, and conversation history
 *
 * This class tracks:
 * - Current conversation stage
 * - Customer information (name, phone, email)
 * - Collected insights (needs, objections, interests)
 * - Conversation history
 * - Sentiment analysis
 */

class ConversationMemory {
  constructor(callId) {
    this.callId = callId;
    this.startTime = Date.now();
    this.stageStartTime = Date.now();

    // Customer data
    this.customer = {
      name: null,
      phone: null,
      email: null
    };

    // Conversation state
    this.currentStage = 'GREETING';
    this.stageHistory = [];
    this.turnCount = 0;
    this.stageTurnCount = 0;

    // Collected insights
    this.needs = [];
    this.objections = [];
    this.interests = [];
    this.sentiment = 'neutral'; // positive/neutral/negative

    // Conversation history
    this.messages = [];

    // Outcome
    this.outcome = null;
    this.nextAction = null;
  }

  /**
   * Add a message to conversation history
   */
  addMessage(role, text) {
    this.messages.push({
      role,
      text,
      timestamp: Date.now(),
      stage: this.currentStage
    });

    // Increment counters
    this.turnCount++;
    this.stageTurnCount++;

    // Extract entities if this is a customer message
    if (role === 'customer') {
      this.extractEntities(text);
      this.analyzeSentiment(text);
    }
  }

  /**
   * Move to a new conversation stage
   */
  moveToStage(newStage) {
    console.log(`\n🔄 Stage transition: ${this.currentStage} → ${newStage}`);

    // Record stage history
    this.stageHistory.push({
      stage: this.currentStage,
      duration: Date.now() - this.stageStartTime,
      turns: this.stageTurnCount
    });

    // Update current stage
    this.currentStage = newStage;
    this.stageTurnCount = 0;
    this.stageStartTime = Date.now();
  }

  /**
   * Extract entities from customer text (name, needs, objections)
   */
  extractEntities(text) {
    const lowerText = text.toLowerCase();

    // Extract name
    if (!this.customer.name) {
      const namePatterns = [
        /קוראים לי ([א-ת]+)/,
        /אני ([א-ת]+)/,
        /שמי ([א-ת]+)/,
        /זה ([א-ת]+)/,
        /^([א-ת]+)$/ // Single word response (likely a name)
      ];

      for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const potentialName = match[1];
          // Validate it's likely a name (not a common word)
          const commonWords = ['כן', 'לא', 'טוב', 'רע', 'אוקיי', 'בסדר', 'הלו', 'שלום'];
          if (!commonWords.includes(potentialName) && potentialName.length >= 2) {
            this.customer.name = potentialName;
            console.log(`   ✅ Name extracted: ${this.customer.name}`);
            break;
          }
        }
      }
    }

    // Extract needs
    const needKeywords = ['צריך', 'רוצה', 'מחפש', 'מעוניין', 'בעיה', 'קשה', 'חשוב', 'דרוש'];
    for (const keyword of needKeywords) {
      if (lowerText.includes(keyword)) {
        // Extract the full sentence
        const sentences = text.split(/[.!?]/);
        const relevantSentence = sentences.find(s => s.toLowerCase().includes(keyword));

        if (relevantSentence) {
          const trimmed = relevantSentence.trim();
          // Check if not already captured
          if (trimmed && !this.needs.some(n => n.includes(trimmed) || trimmed.includes(n))) {
            this.needs.push(trimmed);
            console.log(`   📝 Need extracted: "${trimmed}"`);
          }
        }
      }
    }

    // Extract objections
    const objectionKeywords = [
      'יקר', 'לא בטוח', 'לא מתאים', 'לא מעוניין',
      'אין לי זמן', 'לא עכשיו', 'צריך לחשוב', 'לא בשבילי'
    ];

    for (const keyword of objectionKeywords) {
      if (lowerText.includes(keyword)) {
        const sentences = text.split(/[.!?]/);
        const relevantSentence = sentences.find(s => s.toLowerCase().includes(keyword));

        if (relevantSentence) {
          const trimmed = relevantSentence.trim();
          if (trimmed && !this.objections.some(o => o.includes(trimmed) || trimmed.includes(o))) {
            this.objections.push(trimmed);
            console.log(`   ⚠️  Objection extracted: "${trimmed}"`);
          }
        }
      }
    }

    // Extract interests
    const interestKeywords = ['מעניין', 'נשמע טוב', 'אהבתי', 'נחמד', 'כן'];
    for (const keyword of interestKeywords) {
      if (lowerText.includes(keyword)) {
        const sentences = text.split(/[.!?]/);
        const relevantSentence = sentences.find(s => s.toLowerCase().includes(keyword));

        if (relevantSentence) {
          const trimmed = relevantSentence.trim();
          if (trimmed && !this.interests.some(i => i.includes(trimmed) || trimmed.includes(i))) {
            this.interests.push(trimmed);
            console.log(`   ⭐ Interest extracted: "${trimmed}"`);
          }
        }
      }
    }
  }

  /**
   * Analyze sentiment of customer message
   */
  analyzeSentiment(text) {
    const lowerText = text.toLowerCase();

    const positiveWords = [
      'מעולה', 'נהדר', 'כן', 'בטח', 'מעניין', 'טוב', 'מצוין',
      'אהבתי', 'נחמד', 'כיף', 'שמח', 'תודה', 'נשמע טוב'
    ];

    const negativeWords = [
      'לא', 'רע', 'גרוע', 'לא מעניין', 'אין', 'בעיה', 'קשה',
      'יקר', 'לא בשבילי', 'לא מתאים', 'לא בטוח'
    ];

    let positiveCount = 0;
    let negativeCount = 0;

    positiveWords.forEach(word => {
      if (lowerText.includes(word)) positiveCount++;
    });

    negativeWords.forEach(word => {
      if (lowerText.includes(word)) negativeCount++;
    });

    // Update sentiment
    const prevSentiment = this.sentiment;

    if (positiveCount > negativeCount) {
      this.sentiment = 'positive';
    } else if (negativeCount > positiveCount) {
      this.sentiment = 'negative';
    } else {
      this.sentiment = 'neutral';
    }

    if (prevSentiment !== this.sentiment) {
      console.log(`   😊 Sentiment changed: ${prevSentiment} → ${this.sentiment}`);
    }
  }

  /**
   * Get context for GPT-4 prompt
   */
  getContextForPrompt() {
    return {
      customerName: this.customer.name,
      needs: this.needs,
      objections: this.objections,
      interests: this.interests,
      sentiment: this.sentiment,
      recentMessages: this.messages.slice(-6), // Last 3 exchanges (6 messages)
      currentStage: this.currentStage,
      turnCount: this.turnCount,
      stageTurnCount: this.stageTurnCount
    };
  }

  /**
   * Get full conversation summary for n8n webhook
   */
  getSummary() {
    const duration = Date.now() - this.startTime;

    return {
      // Call metadata
      callId: this.callId,
      duration: Math.round(duration / 1000), // seconds
      timestamp: new Date().toISOString(),

      // Customer data
      customer: {
        name: this.customer.name,
        phone: this.customer.phone,
        email: this.customer.email
      },

      // Conversation insights
      needs: this.needs,
      objections: this.objections,
      interests: this.interests,
      sentiment: this.sentiment,

      // Outcome
      outcome: this.outcome,
      nextAction: this.nextAction,

      // Analytics
      totalTurns: this.turnCount,
      stagesCompleted: this.stageHistory.map(s => s.stage),
      timePerStage: this.stageHistory.reduce((acc, stage) => {
        acc[stage.stage] = Math.round(stage.duration / 1000);
        return acc;
      }, {}),

      // Full transcript
      transcript: this.messages.map(m => ({
        role: m.role,
        text: m.text,
        timestamp: new Date(m.timestamp).toISOString(),
        stage: m.stage
      }))
    };
  }

  /**
   * Get one-line summary of conversation
   */
  getQuickSummary() {
    const name = this.customer.name || 'Unknown';
    const needsSummary = this.needs.length > 0 ? this.needs[0] : 'No needs identified';
    const outcome = this.outcome || 'In progress';

    return `${name} | ${needsSummary} | ${outcome}`;
  }

  /**
   * Print current state (for debugging)
   */
  printState() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 CONVERSATION STATE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎯 Stage: ${this.currentStage} (Turn ${this.stageTurnCount})`);
    console.log(`👤 Customer: ${this.customer.name || 'Unknown'}`);
    console.log(`😊 Sentiment: ${this.sentiment}`);
    console.log(`📝 Needs: ${this.needs.length > 0 ? this.needs.join('; ') : 'None'}`);
    console.log(`⚠️  Objections: ${this.objections.length > 0 ? this.objections.join('; ') : 'None'}`);
    console.log(`⭐ Interests: ${this.interests.length > 0 ? this.interests.join('; ') : 'None'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

module.exports = ConversationMemory;
