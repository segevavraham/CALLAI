// n8n Analytics Logger - Async, non-blocking logging to n8n
// Sends conversation data to n8n without affecting call performance

const axios = require('axios');

class N8nLogger {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
    this.enabled = !!webhookUrl;

    if (this.enabled) {
      console.log('📊 n8n Analytics enabled:', webhookUrl);
    } else {
      console.log('📊 n8n Analytics disabled (no webhook URL)');
    }
  }

  /**
   * Send event to n8n (async, fire-and-forget)
   * Will not throw errors or block execution
   */
  async sendEvent(eventType, data) {
    if (!this.enabled) {
      return;
    }

    // Fire and forget - don't await, don't block
    this._send(eventType, data).catch(error => {
      // Silent fail - don't disrupt the call
      console.warn(`⚠️  n8n logging failed (${eventType}):`, error.message);
    });
  }

  /**
   * Internal send method
   */
  async _send(eventType, data) {
    const payload = {
      eventType,
      timestamp: new Date().toISOString(),
      ...data
    };

    try {
      await axios.post(this.webhookUrl, payload, {
        timeout: 10000, // 10s timeout (increased for reliability)
        headers: { 'Content-Type': 'application/json' }
      });

      // Only log on debug if needed
      // console.log(`📤 n8n event sent: ${eventType}`);
    } catch (error) {
      // Re-throw for catch block above
      throw error;
    }
  }

  /**
   * Log call started
   */
  logCallStarted(callSid, streamSid) {
    this.sendEvent('call.started', {
      callSid,
      streamSid
    });
  }

  /**
   * Log call ended
   */
  logCallEnded(callSid, stats) {
    this.sendEvent('call.ended', {
      callSid,
      ...stats
    });
  }

  /**
   * Log user transcript
   */
  logUserTranscript(callSid, transcript, turnNumber) {
    this.sendEvent('transcript.user', {
      callSid,
      transcript,
      turnNumber,
      role: 'user'
    });
  }

  /**
   * Log AI transcript
   */
  logAITranscript(callSid, transcript, turnNumber) {
    this.sendEvent('transcript.ai', {
      callSid,
      transcript,
      turnNumber,
      role: 'assistant'
    });
  }

  /**
   * Log conversation turn completed
   */
  logTurnCompleted(callSid, turnNumber, userText, aiText) {
    this.sendEvent('turn.completed', {
      callSid,
      turnNumber,
      userText,
      aiText
    });
  }

  /**
   * Log error
   */
  logError(callSid, error, context) {
    this.sendEvent('error', {
      callSid,
      error: error.message,
      stack: error.stack,
      context
    });
  }

  /**
   * Log full conversation history (at end of call)
   */
  logConversation(callSid, conversationHistory, stats) {
    this.sendEvent('conversation.complete', {
      callSid,
      conversationHistory,
      stats
    });
  }
}

module.exports = N8nLogger;
