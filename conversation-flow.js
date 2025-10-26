/**
 * ConversationFlow - Manages conversation stages and transitions
 *
 * Defines the sales conversation flow:
 * GREETING → NAME_COLLECTION → RAPPORT_BUILDING → NEEDS_DISCOVERY →
 * SOLUTION_PITCH → CLOSING → COMPLETED
 */

/**
 * Conversation stage definitions
 */
const CONVERSATION_STAGES = {
  // 1. Greeting - Initial contact
  GREETING: {
    name: 'GREETING',
    agentGoal: 'קבל את תשומת הלב של הלקוח וצור אווירה חמה',
    agentAction: 'אמור שלום, הצג את עצמך בקצרה, ושאל איך קוראים ללקוח',
    expectedCustomerInput: 'הלו / שלום / שם',
    maxTurns: 2,
    priority: 'high'
  },

  // 2. Name Collection - Get customer name if not provided
  NAME_COLLECTION: {
    name: 'NAME_COLLECTION',
    agentGoal: 'קבל את שם הלקוח',
    agentAction: 'שאל בצורה ישירה וחמה: "איך קוראים לך?" או "מה שמך?"',
    expectedCustomerInput: 'שם',
    maxTurns: 2,
    priority: 'high'
  },

  // 3. Rapport Building - Build connection
  RAPPORT_BUILDING: {
    name: 'RAPPORT_BUILDING',
    agentGoal: 'צור קשר אישי וגרום ללקוח להרגיש בנוח',
    agentAction: 'השתמש בשם הלקוח, הראה עניין אמיתי, שאל איך הוא מרגיש',
    expectedCustomerInput: 'סטטוס רגשי / תגובה',
    maxTurns: 1,
    priority: 'medium'
  },

  // 4. Needs Discovery - Understand customer needs
  NEEDS_DISCOVERY: {
    name: 'NEEDS_DISCOVERY',
    agentGoal: 'הבן מה הלקוח צריך ולמה הוא התקשר',
    agentAction: 'שאל שאלות פתוחות: "מה הביא אותך להתקשר?", "ספר לי קצת על המצב שלך"',
    expectedCustomerInput: 'צרכים / בעיות / מטרות',
    maxTurns: 3,
    minNeedsCollected: 1,
    priority: 'critical'
  },

  // 5. Solution Pitch - Present solution
  SOLUTION_PITCH: {
    name: 'SOLUTION_PITCH',
    agentGoal: 'הצג את הפתרון שמתאים לצרכים שזיהית',
    agentAction: 'קשר בין הצרכים שהלקוח אמר לבין הפתרון שלך. השתמש בשם הלקוח',
    expectedCustomerInput: 'שאלות / עניין / התנגדות',
    maxTurns: 3,
    priority: 'critical'
  },

  // 6. Objection Handling - Handle objections
  OBJECTION_HANDLING: {
    name: 'OBJECTION_HANDLING',
    agentGoal: 'הבן את ההתנגדות, הראה אמפתיה, תן מענה',
    agentAction: 'הקשב, אמת את התחושה של הלקוח, תן פתרון או הסבר',
    expectedCustomerInput: 'התנגדות / חשש / שאלה',
    maxTurns: 2,
    priority: 'high'
  },

  // 7. Closing - Ask for commitment
  CLOSING: {
    name: 'CLOSING',
    agentGoal: 'הנע את הלקוח לפעולה ברורה',
    agentAction: 'תן next step ברור: "אז מה נעשה? אני יכול לשלוח לך...", "בוא נקבע..."',
    expectedCustomerInput: 'הסכמה / דחייה / בקשה לזמן',
    maxTurns: 2,
    priority: 'critical'
  },

  // 8. Soft Close - Customer needs time
  SOFT_CLOSE: {
    name: 'SOFT_CLOSE',
    agentGoal: 'שמור על הקשר, השאר דלת פתוחה',
    agentAction: 'הציע follow-up: "בסדר גמור! אשלח לך פרטים, תרגיש חופשי לחזור אליי"',
    expectedCustomerInput: 'הסכמה / תודה',
    maxTurns: 1,
    priority: 'medium'
  },

  // 9. Completed - Success
  COMPLETED_SUCCESS: {
    name: 'COMPLETED_SUCCESS',
    agentGoal: 'סיום חיובי של השיחה',
    agentAction: 'תודה, אשר את הפעולה הבאה, סיום חם',
    isFinal: true,
    outcome: 'SALE',
    priority: 'high'
  },

  // 10. Completed - Follow up
  COMPLETED_FOLLOW_UP: {
    name: 'COMPLETED_FOLLOW_UP',
    agentGoal: 'סיום עם התחייבות ל-follow up',
    agentAction: 'תודה, אשר את ה-follow up, סיום חם',
    isFinal: true,
    outcome: 'FOLLOW_UP',
    priority: 'medium'
  },

  // 11. Completed - No sale
  COMPLETED_NO_SALE: {
    name: 'COMPLETED_NO_SALE',
    agentGoal: 'סיום מכבד',
    agentAction: 'תודה על הזמן, השאר דלת פתוחה לעתיד',
    isFinal: true,
    outcome: 'NO_SALE',
    priority: 'low'
  }
};

/**
 * Conversation Flow Manager
 */
class ConversationFlowManager {
  constructor(memory) {
    this.memory = memory;
  }

  /**
   * Get current stage definition
   */
  getCurrentStage() {
    return CONVERSATION_STAGES[this.memory.currentStage];
  }

  /**
   * Check if current stage is final
   */
  isFinalStage() {
    const stage = this.getCurrentStage();
    return stage && stage.isFinal === true;
  }

  /**
   * Determine if we should transition to a different stage
   * Returns the next stage name or null if should stay in current stage
   */
  shouldTransition(customerText) {
    const currentStage = this.getCurrentStage();

    // Don't transition if we're in a final stage
    if (this.isFinalStage()) {
      return null;
    }

    // Check if we've exceeded max turns for this stage
    if (currentStage.maxTurns && this.memory.stageTurnCount >= currentStage.maxTurns) {
      console.log(`   ⏱️  Max turns reached for ${this.memory.currentStage}`);
      return this.getDefaultTransition();
    }

    // Stage-specific transition logic
    const nextStage = this.evaluateTransition(customerText);
    return nextStage;
  }

  /**
   * Evaluate transition based on current stage and customer input
   */
  evaluateTransition(customerText) {
    const lowerText = customerText.toLowerCase();

    switch (this.memory.currentStage) {
      case 'GREETING':
        return this.transitionFromGreeting(lowerText);

      case 'NAME_COLLECTION':
        return this.transitionFromNameCollection();

      case 'RAPPORT_BUILDING':
        return this.transitionFromRapport();

      case 'NEEDS_DISCOVERY':
        return this.transitionFromNeedsDiscovery();

      case 'SOLUTION_PITCH':
        return this.transitionFromSolutionPitch(lowerText);

      case 'OBJECTION_HANDLING':
        return this.transitionFromObjectionHandling();

      case 'CLOSING':
        return this.transitionFromClosing(lowerText);

      case 'SOFT_CLOSE':
        return 'COMPLETED_FOLLOW_UP';

      default:
        return null;
    }
  }

  /**
   * Transition logic from GREETING stage
   */
  transitionFromGreeting(lowerText) {
    // If we got the name, move to rapport building
    if (this.memory.customer.name) {
      return 'RAPPORT_BUILDING';
    }

    // If customer just said hello/hi, ask for name
    const greetings = ['הלו', 'שלום', 'היי', 'מה נשמע', 'בוקר טוב', 'ערב טוב'];
    if (greetings.some(g => lowerText.includes(g))) {
      return 'NAME_COLLECTION';
    }

    // If we've tried twice, move on
    if (this.memory.stageTurnCount >= 2) {
      return 'NAME_COLLECTION';
    }

    return null; // Stay in greeting
  }

  /**
   * Transition logic from NAME_COLLECTION stage
   */
  transitionFromNameCollection() {
    // If we got the name, move to rapport
    if (this.memory.customer.name) {
      return 'RAPPORT_BUILDING';
    }

    // After 2 attempts, move on anyway (don't force it)
    if (this.memory.stageTurnCount >= 2) {
      return 'RAPPORT_BUILDING';
    }

    return null;
  }

  /**
   * Transition logic from RAPPORT_BUILDING stage
   */
  transitionFromRapport() {
    // Check sentiment - if negative, handle objection
    if (this.memory.sentiment === 'negative') {
      return 'OBJECTION_HANDLING';
    }

    // Move to needs discovery after 1 turn
    return 'NEEDS_DISCOVERY';
  }

  /**
   * Transition logic from NEEDS_DISCOVERY stage
   */
  transitionFromNeedsDiscovery() {
    // If we've collected at least 1 need, move to pitch
    if (this.memory.needs.length >= 1) {
      return 'SOLUTION_PITCH';
    }

    // If we've asked 3 times and still no clear needs, try to pitch anyway
    if (this.memory.stageTurnCount >= 3) {
      return 'SOLUTION_PITCH';
    }

    return null; // Keep asking
  }

  /**
   * Transition logic from SOLUTION_PITCH stage
   */
  transitionFromSolutionPitch(lowerText) {
    // Check if customer raised new objection
    if (this.memory.objections.length > 0) {
      // Check if this objection was just added (in recent turn)
      const recentObjections = this.memory.objections.slice(-1);
      if (recentObjections.length > 0) {
        return 'OBJECTION_HANDLING';
      }
    }

    // Check if customer seems very interested
    if (this.memory.sentiment === 'positive' && this.memory.interests.length > 0) {
      return 'CLOSING';
    }

    // After 3 turns of pitching, try to close
    if (this.memory.stageTurnCount >= 3) {
      return 'CLOSING';
    }

    return null; // Keep pitching
  }

  /**
   * Transition logic from OBJECTION_HANDLING stage
   */
  transitionFromObjectionHandling() {
    // If sentiment improved to positive, go back to pitch
    if (this.memory.sentiment === 'positive') {
      return 'SOLUTION_PITCH';
    }

    // If customer still negative after 2 turns, soft close
    if (this.memory.stageTurnCount >= 2 && this.memory.sentiment === 'negative') {
      return 'SOFT_CLOSE';
    }

    // If neutral, give it one more chance with pitch
    if (this.memory.stageTurnCount >= 1 && this.memory.sentiment === 'neutral') {
      return 'SOLUTION_PITCH';
    }

    return null; // Keep handling objections
  }

  /**
   * Transition logic from CLOSING stage
   */
  transitionFromClosing(lowerText) {
    // Detect agreement
    const agreementWords = ['כן', 'בטח', 'אוקיי', 'טוב', 'נשמע טוב', 'בסדר', 'מעולה', 'נהדר'];
    const hasAgreement = agreementWords.some(w => lowerText.includes(w));

    if (hasAgreement && !lowerText.includes('לא')) {
      this.memory.outcome = 'SALE';
      return 'COMPLETED_SUCCESS';
    }

    // Detect need for time to think
    const needsTimeWords = ['אחשוב', 'אחזור', 'תן לי זמן', 'נדבר', 'מחר', 'אשקול'];
    const needsTime = needsTimeWords.some(w => lowerText.includes(w));

    if (needsTime) {
      this.memory.outcome = 'FOLLOW_UP';
      this.memory.nextAction = 'Follow up in 1-2 days';
      return 'SOFT_CLOSE';
    }

    // Detect refusal
    const refusalWords = ['לא', 'לא מעוניין', 'לא בשבילי', 'לא מתאים', 'תודה אבל'];
    const hasRefusal = refusalWords.some(w => lowerText.includes(w));

    if (hasRefusal) {
      this.memory.outcome = 'NO_SALE';
      return 'COMPLETED_NO_SALE';
    }

    // After 2 closing attempts, soft close
    if (this.memory.stageTurnCount >= 2) {
      return 'SOFT_CLOSE';
    }

    return null; // Keep trying to close
  }

  /**
   * Get default transition (fallback)
   */
  getDefaultTransition() {
    const stageOrder = [
      'GREETING',
      'NAME_COLLECTION',
      'RAPPORT_BUILDING',
      'NEEDS_DISCOVERY',
      'SOLUTION_PITCH',
      'CLOSING',
      'SOFT_CLOSE'
    ];

    const currentIndex = stageOrder.indexOf(this.memory.currentStage);

    if (currentIndex >= 0 && currentIndex < stageOrder.length - 1) {
      return stageOrder[currentIndex + 1];
    }

    return 'SOFT_CLOSE'; // Default end
  }

  /**
   * Process transition if needed
   */
  processTransition(customerText) {
    const nextStage = this.shouldTransition(customerText);

    if (nextStage && nextStage !== this.memory.currentStage) {
      this.memory.moveToStage(nextStage);
      return true; // Transition occurred
    }

    return false; // No transition
  }
}

module.exports = {
  CONVERSATION_STAGES,
  ConversationFlowManager
};
