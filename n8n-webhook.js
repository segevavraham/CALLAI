/**
 * n8n Webhook Integration
 *
 * Sends call summary and analytics to n8n webhook after call ends
 * This allows for:
 * - Call recording and analytics
 * - Automated follow-ups (SMS, email)
 * - CRM integration
 * - Lead scoring
 */

class N8NWebhook {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
    this.enabled = !!webhookUrl;
  }

  /**
   * Send call summary to n8n webhook
   *
   * @param {Object} memory - ConversationMemory instance
   * @returns {Promise<void>}
   */
  async sendCallSummary(memory) {
    if (!this.enabled) {
      console.log('📊 n8n webhook disabled (no URL configured)');
      return;
    }

    try {
      const summary = memory.getSummary();

      // Enrich with additional analytics
      const payload = {
        // Call metadata
        callId: summary.callId,
        duration: summary.duration,
        durationFormatted: this.formatDuration(summary.duration),
        timestamp: summary.timestamp,

        // Customer data
        customer: {
          name: summary.customer.name || 'Unknown',
          phone: summary.customer.phone,
          email: summary.customer.email
        },

        // Conversation insights
        needs: summary.needs,
        objections: summary.objections,
        interests: summary.interests,
        sentiment: summary.sentiment,

        // Outcome
        outcome: summary.outcome,
        nextAction: summary.nextAction,

        // Analytics
        totalTurns: summary.totalTurns,
        stagesCompleted: summary.stagesCompleted,
        timePerStage: summary.timePerStage,

        // Quality metrics
        qualityScore: this.calculateQualityScore(summary),
        completionRate: this.calculateCompletionRate(summary),

        // Full transcript
        transcript: summary.transcript,

        // AI-generated summary
        aiSummary: this.generateAISummary(summary)
      };

      console.log(`\n📤 Sending call summary to n8n webhook...`);
      console.log(`   📞 Call ID: ${summary.callId}`);
      console.log(`   👤 Customer: ${payload.customer.name}`);
      console.log(`   🎯 Outcome: ${summary.outcome}`);
      console.log(`   ⏱️  Duration: ${payload.durationFormatted}`);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ Call summary sent to n8n successfully`);

    } catch (error) {
      console.error('❌ Failed to send call summary to n8n:', error.message);
      // Don't throw - webhook failures shouldn't crash the app
    }
  }

  /**
   * Format duration in seconds to human-readable format
   */
  formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  /**
   * Calculate quality score (0-100)
   * Based on: needs identified, objections handled, outcome, duration
   */
  calculateQualityScore(summary) {
    let score = 0;

    // Customer name collected (+20 points)
    if (summary.customer.name) score += 20;

    // Needs identified (+20 points)
    if (summary.needs.length > 0) score += 20;

    // Positive sentiment (+20 points)
    if (summary.sentiment === 'positive') score += 20;
    else if (summary.sentiment === 'neutral') score += 10;

    // Good outcome (+40 points)
    if (summary.outcome === 'SALE') score += 40;
    else if (summary.outcome === 'FOLLOW_UP') score += 30;
    else if (summary.outcome === 'NO_SALE') score += 10;

    // Duration (good conversation length)
    if (summary.duration >= 30 && summary.duration <= 300) score += 10; // 30s - 5min

    // Objections handled (bonus if objections raised but ended positive)
    if (summary.objections.length > 0 && summary.sentiment === 'positive') {
      score += 10; // Handled objections well
    }

    return Math.min(100, score);
  }

  /**
   * Calculate completion rate - how far through the conversation flow
   */
  calculateCompletionRate(summary) {
    const allStages = [
      'GREETING', 'NAME_COLLECTION', 'RAPPORT_BUILDING',
      'NEEDS_DISCOVERY', 'SOLUTION_PITCH', 'CLOSING'
    ];

    const completedCount = summary.stagesCompleted.filter(s =>
      allStages.includes(s)
    ).length;

    return Math.round((completedCount / allStages.length) * 100);
  }

  /**
   * Generate human-readable AI summary
   */
  generateAISummary(summary) {
    const name = summary.customer.name || 'The customer';
    const outcome = {
      'SALE': 'agreed to move forward',
      'FOLLOW_UP': 'requested follow-up',
      'NO_SALE': 'declined the offer'
    }[summary.outcome] || 'ended the call';

    const needsSummary = summary.needs.length > 0
      ? `Looking for: ${summary.needs[0]}`
      : 'No specific needs identified';

    const objectionsSummary = summary.objections.length > 0
      ? ` Raised concerns: ${summary.objections[0]}`
      : '';

    return `${name} called. ${needsSummary}.${objectionsSummary} ${name} ${outcome}.`;
  }

  /**
   * Send real-time event during call (optional)
   * Can be used for live dashboard, manager notifications, etc.
   */
  async sendLiveEvent(eventType, data) {
    if (!this.enabled) return;

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'live_event',
          eventType,
          timestamp: new Date().toISOString(),
          ...data
        })
      });
    } catch (error) {
      // Silently fail for live events
      console.error('⚠️  Failed to send live event:', error.message);
    }
  }

  /**
   * Check if webhook is configured
   */
  static isConfigured() {
    return !!process.env.N8N_WEBHOOK_URL;
  }
}

module.exports = N8NWebhook;
