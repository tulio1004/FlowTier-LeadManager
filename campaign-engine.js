// ============================================
// FlowTier Campaign Engine v1.0
// Email outreach campaign system with
// multi-step sequences, scheduling, and
// webhook integration for Make.com
// ============================================

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CAMPAIGNS_DIR = path.join(__dirname, 'data', 'campaigns');
const BLACKLIST_FILE = path.join(__dirname, 'config', 'blacklist.json');

// Ensure directories
if (!fs.existsSync(CAMPAIGNS_DIR)) fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });

// ============================================
// DATA ACCESS
// ============================================
function readCampaign(id) {
  const file = path.join(CAMPAIGNS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeCampaign(campaign) {
  const file = path.join(CAMPAIGNS_DIR, `${campaign.id}.json`);
  fs.writeFileSync(file, JSON.stringify(campaign, null, 2));
}

function deleteCampaignFile(id) {
  const file = path.join(CAMPAIGNS_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function getAllCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_DIR)) return [];
  return fs.readdirSync(CAMPAIGNS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ============================================
// BLACKLIST
// ============================================
function getBlacklist() {
  if (!fs.existsSync(BLACKLIST_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8')); }
  catch { return []; }
}

function saveBlacklist(list) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2));
}

function isBlacklisted(email) {
  const list = getBlacklist();
  return list.some(e => e.email.toLowerCase() === email.toLowerCase());
}

function addToBlacklist(email, reason) {
  const list = getBlacklist();
  if (!list.some(e => e.email.toLowerCase() === email.toLowerCase())) {
    list.push({ email: email.toLowerCase(), reason: reason || '', added_at: new Date().toISOString() });
    saveBlacklist(list);
  }
  return list;
}

function removeFromBlacklist(email) {
  let list = getBlacklist();
  list = list.filter(e => e.email.toLowerCase() !== email.toLowerCase());
  saveBlacklist(list);
  return list;
}

// ============================================
// CAMPAIGN DATA MODEL
// ============================================
function createCampaignObject(data) {
  return {
    id: data.id || uuidv4(),
    name: data.name || 'Untitled Campaign',
    description: data.description || '',
    status: data.status || 'draft', // draft, active, paused, completed
    webhook_url: data.webhook_url || '', // Make.com scenario webhook
    
    // Scheduling
    schedule: {
      frequency_minutes: data.schedule?.frequency_minutes || 5, // 1 email every X minutes
      time_windows: data.schedule?.time_windows || [
        { start: '09:00', end: '17:00' }
      ],
      timezone: data.schedule?.timezone || 'America/New_York',
      daily_limit: data.schedule?.daily_limit || 50,
      days_of_week: data.schedule?.days_of_week || [1, 2, 3, 4, 5] // Mon-Fri
    },
    
    // Multi-step email sequence
    steps: data.steps || [
      {
        id: uuidv4(),
        step_number: 1,
        subject_template: '',
        body_template: '',
        delay_days: 0, // days after previous step (0 = immediate for step 1)
        active: true
      }
    ],
    
    // Leads in this campaign
    leads: data.leads || [],
    // Each lead entry: { lead_id, email, status, current_step, last_sent_at, sent_count, paused, added_at }
    
    // Stats
    stats: {
      total_leads: 0,
      emails_sent: 0,
      replies_received: 0,
      bounces: 0,
      opted_out: 0,
      sends_today: 0,
      sends_today_date: new Date().toISOString().slice(0, 10)
    },
    
    // Tracking
    created_at: data.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: data.started_at || null,
    completed_at: data.completed_at || null
  };
}

// ============================================
// SCHEDULING ENGINE
// ============================================
class CampaignScheduler {
  constructor(leadReader, leadWriter, webhookHistoryAdder) {
    this.timers = new Map(); // campaign_id -> interval
    this.readLead = leadReader;
    this.writeLead = leadWriter;
    this.addWebhookHistory = webhookHistoryAdder;
  }

  // Check if current time is within a campaign's time windows
  isWithinTimeWindow(campaign) {
    const tz = campaign.schedule.timezone || 'America/New_York';
    let now;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const parts = formatter.format(new Date());
      now = parts; // "HH:MM"
    } catch {
      const d = new Date();
      now = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    const nowMinutes = this.timeToMinutes(now);
    
    // Check day of week
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDay = dayMap[dayFormatter.format(new Date())] || 0;
    
    if (campaign.schedule.days_of_week && !campaign.schedule.days_of_week.includes(currentDay)) {
      return false;
    }

    for (const window of campaign.schedule.time_windows) {
      const start = this.timeToMinutes(window.start);
      const end = this.timeToMinutes(window.end);
      if (nowMinutes >= start && nowMinutes < end) return true;
    }
    return false;
  }

  timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  // Check daily limit
  checkDailyLimit(campaign) {
    const today = new Date().toISOString().slice(0, 10);
    if (campaign.stats.sends_today_date !== today) {
      campaign.stats.sends_today = 0;
      campaign.stats.sends_today_date = today;
    }
    return campaign.stats.sends_today < (campaign.schedule.daily_limit || 50);
  }

  // Find next lead to email in campaign
  findNextLead(campaign) {
    const blacklist = getBlacklist();
    const blacklistSet = new Set(blacklist.map(b => b.email.toLowerCase()));

    for (const entry of campaign.leads) {
      // Skip if already completed all steps, paused, bounced, replied, or opted out
      if (entry.status === 'completed' || entry.status === 'bounced' || 
          entry.status === 'replied' || entry.status === 'opted_out' || entry.paused) {
        continue;
      }

      // Skip blacklisted emails
      if (blacklistSet.has((entry.email || '').toLowerCase())) {
        entry.status = 'blacklisted';
        continue;
      }

      // Skip leads in human mode (manual follow-up)
      if (entry.lead_id && this.readLead) {
        try {
          const ld = this.readLead(entry.lead_id);
          if (ld && ld.human_mode === true) {
            console.log(`[Campaign] Skipping ${entry.email} — lead is in Human Mode`);
            continue;
          }
        } catch (e) { /* ignore read errors */ }
      }

      // Determine current step
      const currentStepNum = entry.current_step || 1;
      const step = campaign.steps.find(s => s.step_number === currentStepNum && s.active);
      if (!step) {
        entry.status = 'completed';
        continue;
      }

      // Check delay from last send
      if (currentStepNum > 1 && entry.last_sent_at) {
        const daysSinceLastSend = (Date.now() - new Date(entry.last_sent_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLastSend < step.delay_days) continue;
      }

      return { entry, step };
    }
    return null;
  }

  // Fire webhook for a single email
  async fireEmailWebhook(campaign, entry, step, leadData) {
    if (!campaign.webhook_url) return null;

    // Build conversation history from lead's outreach
    const conversationHistory = (leadData.outreach || [])
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(o => ({
        direction: o.direction,
        subject: o.subject,
        body: o.body,
        timestamp: o.timestamp,
        channel: o.channel
      }));

    // Render template with merge fields
    const mergeFields = {
      '{{contact_name}}': leadData.contact_name || '',
      '{{first_name}}': (leadData.contact_name || '').split(' ')[0],
      '{{company_name}}': leadData.company_name || '',
      '{{industry}}': leadData.industry || '',
      '{{website}}': leadData.website || '',
      '{{email}}': entry.email || (leadData.emails || [])[0] || '',
      '{{deal_value}}': leadData.deal_value ? `$${leadData.deal_value.toLocaleString()}` : '',
      '{{address}}': leadData.address || '',
      '{{phone}}': (leadData.phones || [])[0] || ''
    };

    let renderedSubject = step.subject_template || '';
    let renderedBody = step.body_template || '';
    for (const [key, val] of Object.entries(mergeFields)) {
      renderedSubject = renderedSubject.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
      renderedBody = renderedBody.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
    }

    const payload = {
      event: 'campaign_email_due',
      timestamp: new Date().toISOString(),
      campaign: {
        id: campaign.id,
        name: campaign.name
      },
      step: {
        number: step.step_number,
        subject_template: renderedSubject,
        body_template: renderedBody,
        raw_subject_template: step.subject_template,
        raw_body_template: step.body_template
      },
      lead: {
        id: leadData.id,
        contact_name: leadData.contact_name,
        company_name: leadData.company_name,
        email: entry.email || (leadData.emails || [])[0],
        emails: leadData.emails,
        phones: leadData.phones,
        industry: leadData.industry,
        website: leadData.website,
        linkedin: leadData.linkedin,
        address: leadData.address,
        company_size: leadData.company_size,
        details: leadData.details,
        deal_value: leadData.deal_value,
        tags: leadData.tags,
        custom_fields: leadData.custom_fields,
        notes: (leadData.notes || []).map(n => ({
          title: n.title,
          content: n.content ? n.content.replace(/<[^>]*>/g, '').substring(0, 500) : '',
          type: n.type,
          created_at: n.created_at
        })),
        conversation_history: conversationHistory
      },
      callback_urls: {
        log_send: `/api/campaigns/${campaign.id}/log-send`,
        log_reply: `/api/campaigns/${campaign.id}/reply`,
        log_bounce: `/api/campaigns/${campaign.id}/bounce`
      }
    };

    try {
      const response = await fetch(campaign.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'flowtier-campaign-engine',
          'X-Event-Type': 'campaign_email_due',
          'X-Campaign-Id': campaign.id,
          'X-Step-Number': String(step.step_number)
        },
        body: JSON.stringify(payload)
      });

      const text = await response.text();

      // Try to parse webhook response as JSON
      // Make.com can respond with send confirmation data
      let responseData = null;
      try {
        responseData = JSON.parse(text);
      } catch (e) {
        // Not JSON — that's fine, just use HTTP status
      }

      if (this.addWebhookHistory) {
        this.addWebhookHistory({
          id: uuidv4(),
          event_type: 'campaign_email_due',
          timestamp: new Date().toISOString(),
          url: campaign.webhook_url,
          status: response.status,
          response: text.substring(0, 500),
          campaign_id: campaign.id,
          lead_id: leadData.id,
          step_number: step.step_number
        });
      }

      return { success: response.ok, status: response.status, body: text, data: responseData };
    } catch (err) {
      console.error(`[Campaign] Webhook error for ${campaign.id}:`, err.message);
      if (this.addWebhookHistory) {
        this.addWebhookHistory({
          id: uuidv4(),
          event_type: 'campaign_email_due',
          timestamp: new Date().toISOString(),
          url: campaign.webhook_url,
          error: err.message,
          campaign_id: campaign.id,
          lead_id: leadData.id,
          step_number: step.step_number
        });
      }
      return null;
    }
  }

  // Process one tick of a campaign
  async processTick(campaignId) {
    const campaign = readCampaign(campaignId);
    if (!campaign || campaign.status !== 'active') {
      console.log(`[Campaign] Tick skipped for ${campaignId}: ${!campaign ? 'campaign not found' : `status is "${campaign.status}" (not active)`}`);
      this.stopCampaign(campaignId);
      return;
    }

    // Check time window
    if (!this.isWithinTimeWindow(campaign)) {
      const tz = campaign.schedule.timezone || 'America/New_York';
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
      console.log(`[Campaign] ${campaign.name}: Outside time window — now: ${dayFormatter.format(new Date())} ${formatter.format(new Date())}, allowed days: ${JSON.stringify(campaign.schedule.days_of_week)}, windows: ${JSON.stringify(campaign.schedule.time_windows)}`);
      return;
    }

    // Check daily limit
    if (!this.checkDailyLimit(campaign)) {
      console.log(`[Campaign] ${campaign.name}: Daily limit reached (${campaign.stats.sends_today}/${campaign.schedule.daily_limit})`);
      return;
    }

    // Find next lead
    const next = this.findNextLead(campaign);
    if (!next) {
      // Check if all leads are done
      const allDone = campaign.leads.every(l => 
        ['completed', 'bounced', 'replied', 'opted_out', 'blacklisted'].includes(l.status)
      );
      if (allDone && campaign.leads.length > 0) {
        campaign.status = 'completed';
        campaign.completed_at = new Date().toISOString();
        writeCampaign(campaign);
        this.stopCampaign(campaignId);
        console.log(`[Campaign] ${campaign.name}: Completed — all leads processed`);
      } else {
        console.log(`[Campaign] ${campaign.name}: No eligible leads found. Lead statuses: ${campaign.leads.map(l => `${l.email}=${l.status}`).join(', ')}`);
      }
      return;
    }

    const { entry, step } = next;

    // Read full lead data
    const leadData = this.readLead(entry.lead_id);
    if (!leadData) {
      entry.status = 'error';
      entry.error = 'Lead not found in CRM';
      writeCampaign(campaign);
      return;
    }

    // Fire webhook
    console.log(`[Campaign] ${campaign.name}: Sending step ${step.step_number} to ${leadData.company_name} (${entry.email})`);
    const result = await this.fireEmailWebhook(campaign, entry, step, leadData);

    if (result && result.success) {
      // Parse webhook response data from Make.com
      // Make.com can respond with: { "status": "sent", "email_sent": "actual email body", "subject_sent": "actual subject" }
      const responseData = result.data || {};
      const webhookStatus = (responseData.status || 'sent').toLowerCase();

      // If Make.com explicitly says it failed, don't mark as sent
      if (webhookStatus === 'failed' || webhookStatus === 'error') {
        console.error(`[Campaign] ${campaign.name}: Make.com reported failure for ${entry.email}:`, responseData.error || 'Unknown error');
        entry.error = responseData.error || 'Send failed (reported by Make.com)';
        writeCampaign(campaign);
        return;
      }

      // Update campaign lead entry
      entry.last_sent_at = new Date().toISOString();
      entry.sent_count = (entry.sent_count || 0) + 1;
      entry.status = 'sent';
      entry.last_step_sent = step.step_number;

      // Move to next step or mark completed
      const nextStep = campaign.steps.find(s => s.step_number === step.step_number + 1 && s.active);
      if (nextStep) {
        entry.current_step = nextStep.step_number;
        entry.status = 'waiting'; // waiting for delay before next step
      } else {
        entry.status = 'completed'; // all steps done
      }

      // Use actual email content from Make.com response if available
      // This captures the AI-personalized version that was actually sent
      const actualSubject = responseData.subject_sent || responseData.subject || step.subject_template || `Campaign: ${campaign.name} - Step ${step.step_number}`;
      const actualBody = responseData.email_sent || responseData.body || responseData.email_body || step.body_template || '';
      const fromEmail = responseData.from_email || responseData.sender || '';

      // Update campaign stats
      campaign.stats.emails_sent++;
      campaign.stats.sends_today++;
      campaign.updated_at = new Date().toISOString();

      writeCampaign(campaign);

      // Log outreach on the lead with the ACTUAL email content
      if (!leadData.outreach) leadData.outreach = [];
      leadData.outreach.unshift({
        id: uuidv4(),
        direction: 'sent',
        channel: 'email',
        subject: actualSubject,
        body: actualBody,
        from_email: fromEmail,
        to_email: entry.email,
        template_name: `${campaign.name} - Step ${step.step_number}`,
        campaign_id: campaign.id,
        campaign_step: step.step_number,
        timestamp: new Date().toISOString()
      });

      if (!leadData.activity) leadData.activity = [];
      leadData.activity.push({
        type: 'outreach',
        message: `Campaign "${campaign.name}" - Step ${step.step_number} email sent`,
        campaign_id: campaign.id,
        timestamp: new Date().toISOString()
      });

      leadData.last_contacted = new Date().toISOString();
      leadData.updated_at = new Date().toISOString();
      this.writeLead(leadData);

      console.log(`[Campaign] ${campaign.name}: Step ${step.step_number} confirmed sent to ${entry.email}${responseData.subject_sent ? ' (AI-personalized)' : ''}`);
    } else {
      console.error(`[Campaign] ${campaign.name}: Webhook failed for ${entry.email}`);
      // Don't mark as failed — will retry on next tick
    }
  }

  // Start a campaign's scheduler
  startCampaign(campaignId) {
    if (this.timers.has(campaignId)) {
      clearInterval(this.timers.get(campaignId));
    }

    const campaign = readCampaign(campaignId);
    if (!campaign) return false;

    const intervalMs = (campaign.schedule.frequency_minutes || 5) * 60 * 1000;

    console.log(`[Campaign] Starting "${campaign.name}" — every ${campaign.schedule.frequency_minutes} min, status: ${campaign.status}, leads: ${campaign.leads.length}, webhook: ${campaign.webhook_url ? 'configured' : 'MISSING'}, days: ${JSON.stringify(campaign.schedule.days_of_week)}, windows: ${JSON.stringify(campaign.schedule.time_windows)}`);

    // Run immediately once, then on interval
    console.log(`[Campaign] Firing immediate first tick for "${campaign.name}"`);
    this.processTick(campaignId);

    const timer = setInterval(() => {
      this.processTick(campaignId);
    }, intervalMs);

    this.timers.set(campaignId, timer);
    return true;
  }

  // Stop a campaign's scheduler
  stopCampaign(campaignId) {
    if (this.timers.has(campaignId)) {
      clearInterval(this.timers.get(campaignId));
      this.timers.delete(campaignId);
      console.log(`[Campaign] Stopped campaign ${campaignId}`);
    }
  }

  // Resume all active campaigns on server start
  resumeActiveCampaigns() {
    const campaigns = getAllCampaigns();
    let resumed = 0;
    campaigns.forEach(c => {
      if (c.status === 'active') {
        this.startCampaign(c.id);
        resumed++;
      }
    });
    if (resumed > 0) {
      console.log(`[Campaign] Resumed ${resumed} active campaign(s)`);
    }
  }

  // Stop all campaigns
  stopAll() {
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
  readCampaign,
  writeCampaign,
  deleteCampaignFile,
  getAllCampaigns,
  createCampaignObject,
  getBlacklist,
  saveBlacklist,
  isBlacklisted,
  addToBlacklist,
  removeFromBlacklist,
  CampaignScheduler
};
