/* ============================================
   SERVER.JS — FlowTier Lead Management System v2.0
   Express server for leads.flowtier.io
   ============================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const {
  readCampaign, writeCampaign, deleteCampaignFile, getAllCampaigns,
  createCampaignObject, getBlacklist, saveBlacklist, isBlacklisted,
  addToBlacklist, removeFromBlacklist, CampaignScheduler
} = require('./campaign-engine');

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_DIR = path.join(__dirname, 'config');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Auth credentials
const ADMIN_USER = process.env.ADMIN_USER || 'tulio';
const ADMIN_PASS = process.env.ADMIN_PASS || '25524515Fl0wT13r';
const API_KEY = process.env.API_KEY || null;

// Ensure directories exist
[DATA_DIR, CONFIG_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================
// LEAD STAGES
// ============================================
const STAGES = [
  { id: 'cold', label: 'Cold', color: '#78909C', description: 'Never reached out' },
  { id: 'contacted', label: 'Contacted', color: '#64B5F6', description: 'First outreach sent' },
  { id: 'qualified', label: 'Qualified', color: '#FFB74D', description: 'Showed interest in automation' },
  { id: 'call_booked', label: 'Call Booked', color: '#CE93D8', description: 'Meeting scheduled' },
  { id: 'proposal_sent', label: 'Proposal Sent', color: '#4DD0E1', description: 'Proposal delivered' },
  { id: 'won', label: 'Won', color: '#00E676', description: 'Closed deal' },
  { id: 'lost', label: 'Lost', color: '#FF5252', description: 'Did not convert' }
];

// ============================================
// DEFAULT INDUSTRIES & SOURCES
// ============================================
const DEFAULT_INDUSTRIES = [
  'Construction', 'Landscaping', 'Roofing', 'HVAC', 'Salon/Spa', 'Solar',
  'Dental', 'Healthcare', 'Real Estate', 'Legal',
  'Insurance', 'Home Services', 'Marketing Agency', 'Education'
];

const DEFAULT_SOURCES = ['Website', 'Scraper', 'Instagram', 'Referral', 'Make.com', 'CSV Import', 'Other'];

// ============================================
// PERSISTENT CONFIG HELPERS
// ============================================
const WEBHOOK_CONFIG_FILE = path.join(CONFIG_DIR, 'webhook.json');
const INDUSTRIES_FILE = path.join(CONFIG_DIR, 'industries.json');
const WEBHOOK_HISTORY_FILE = path.join(CONFIG_DIR, 'webhook_history.json');
const EMAIL_TEMPLATES_FILE = path.join(CONFIG_DIR, 'email_templates.json');

function getWebhookUrl() {
  try {
    if (fs.existsSync(WEBHOOK_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOK_CONFIG_FILE, 'utf8')).url || '';
    }
  } catch (e) {}
  return '';
}

function setWebhookUrl(url) {
  fs.writeFileSync(WEBHOOK_CONFIG_FILE, JSON.stringify({ url, updated_at: new Date().toISOString() }, null, 2), 'utf8');
}

function getIndustries() {
  try {
    if (fs.existsSync(INDUSTRIES_FILE)) {
      return JSON.parse(fs.readFileSync(INDUSTRIES_FILE, 'utf8')).industries || DEFAULT_INDUSTRIES;
    }
  } catch (e) {}
  return DEFAULT_INDUSTRIES;
}

function setIndustries(list) {
  fs.writeFileSync(INDUSTRIES_FILE, JSON.stringify({ industries: list, updated_at: new Date().toISOString() }, null, 2), 'utf8');
}

function getWebhookHistory() {
  try {
    if (fs.existsSync(WEBHOOK_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOK_HISTORY_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function addWebhookHistory(entry) {
  const history = getWebhookHistory();
  history.unshift(entry);
  // Keep last 100 entries
  const trimmed = history.slice(0, 100);
  fs.writeFileSync(WEBHOOK_HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

function getEmailTemplates() {
  try {
    if (fs.existsSync(EMAIL_TEMPLATES_FILE)) {
      return JSON.parse(fs.readFileSync(EMAIL_TEMPLATES_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveEmailTemplates(templates) {
  fs.writeFileSync(EMAIL_TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf8');
}

// ============================================
// LEAD DATA HELPERS
// ============================================
function getLeadPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function readLead(id) {
  const p = getLeadPath(id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function writeLead(lead) {
  fs.writeFileSync(getLeadPath(lead.id), JSON.stringify(lead, null, 2), 'utf8');
}

function deleteLead(id) {
  const p = getLeadPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getAllLeads() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
    catch (e) { return null; }
  }).filter(Boolean);
}

// ============================================
// LEAD SCORING
// ============================================
function calculateLeadScore(lead) {
  let score = 0;
  if (lead.emails && lead.emails.length > 0) score += 10;
  if (lead.phones && lead.phones.length > 0) score += 10;
  if (lead.website) score += 5;
  if (lead.linkedin) score += 5;
  if (lead.company_name) score += 5;
  if (lead.contact_name) score += 5;
  if (lead.details && lead.details.length > 50) score += 10;
  if (lead.deal_value > 0) score += 10;
  if (lead.address) score += 5;
  if (lead.company_size) score += 5;

  // Stage-based scoring
  const stageScores = { cold: 0, contacted: 10, qualified: 25, call_booked: 35, proposal_sent: 45, won: 50, lost: -10 };
  score += stageScores[lead.stage] || 0;

  // Engagement scoring
  if (lead.notes && lead.notes.length > 0) score += Math.min(lead.notes.length * 5, 20);
  if (lead.outreach && lead.outreach.length > 0) score += Math.min(lead.outreach.length * 5, 15);
  if (lead.calendar_event) score += 15;

  // Tags bonus
  if (lead.tags && lead.tags.some(t => t.toLowerCase().includes('high-priority'))) score += 10;

  return Math.min(score, 100);
}

// ============================================
// DUPLICATE DETECTION
// ============================================
function findDuplicates(data) {
  const allLeads = getAllLeads();
  const duplicates = [];

  allLeads.forEach(existing => {
    let matchScore = 0;
    let matchReasons = [];

    // Email match (strongest signal)
    if (data.emails && data.emails.length > 0 && existing.emails && existing.emails.length > 0) {
      const overlap = data.emails.filter(e => existing.emails.some(ex => ex.toLowerCase() === e.toLowerCase()));
      if (overlap.length > 0) { matchScore += 80; matchReasons.push('Email match: ' + overlap.join(', ')); }
    }

    // Company name match
    if (data.company_name && existing.company_name) {
      if (data.company_name.toLowerCase().trim() === existing.company_name.toLowerCase().trim()) {
        matchScore += 60; matchReasons.push('Exact company name match');
      } else if (data.company_name.toLowerCase().includes(existing.company_name.toLowerCase()) ||
                 existing.company_name.toLowerCase().includes(data.company_name.toLowerCase())) {
        matchScore += 30; matchReasons.push('Partial company name match');
      }
    }

    // Phone match
    if (data.phones && data.phones.length > 0 && existing.phones && existing.phones.length > 0) {
      const normalizePhone = p => p.replace(/\D/g, '').slice(-10);
      const overlap = data.phones.filter(p => existing.phones.some(ep => normalizePhone(p) === normalizePhone(ep)));
      if (overlap.length > 0) { matchScore += 70; matchReasons.push('Phone match'); }
    }

    if (matchScore >= 50) {
      duplicates.push({
        lead_id: existing.id,
        company_name: existing.company_name,
        contact_name: existing.contact_name,
        match_score: matchScore,
        reasons: matchReasons
      });
    }
  });

  return duplicates.sort((a, b) => b.match_score - a.match_score);
}

// ============================================
// CREATE LEAD OBJECT
// ============================================
function createLeadObject(data) {
  const now = new Date().toISOString();
  return {
    id: data.id || uuidv4(),
    company_name: data.company_name || '',
    contact_name: data.contact_name || '',
    emails: Array.isArray(data.emails) ? data.emails : (data.email ? [data.email] : []),
    phones: Array.isArray(data.phones) ? data.phones : (data.phone ? [data.phone] : []),
    website: data.website || '',
    linkedin: data.linkedin || '',
    address: data.address || '',
    industry: data.industry || '',
    company_size: data.company_size || '',
    revenue_estimate: data.revenue_estimate || '',
    lead_source: data.lead_source || '',
    tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
    stage: data.stage || 'cold',
    assigned_to: data.assigned_to || '',
    deal_value: data.deal_value || 0,
    details: data.details || '',
    last_contacted: data.last_contacted || null,
    next_followup: data.next_followup || null,
    calendar_event: data.calendar_event || null,
    proposal_url: data.proposal_url || '',
    notes: Array.isArray(data.notes) ? data.notes : [],
    outreach: Array.isArray(data.outreach) ? data.outreach : [],
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    custom_fields: data.custom_fields || {},
    activity: Array.isArray(data.activity) ? data.activity : [],
    lead_score: 0,
    created_at: data.created_at || now,
    updated_at: now,
    _source: data._source || 'manual'
  };
}

// ============================================
// WEBHOOK NOTIFICATION HELPER
// ============================================
async function sendWebhookNotification(eventType, payload) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    console.log(`[Webhook] No URL configured. Skipping ${eventType}.`);
    return null;
  }

  const entry = {
    id: uuidv4(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    url: webhookUrl,
    status: null,
    response: null,
    error: null
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'flowtier-lead-system',
        'X-Event-Type': eventType
      },
      body: JSON.stringify({
        event: eventType,
        timestamp: new Date().toISOString(),
        ...payload
      })
    });

    const text = await response.text();
    entry.status = response.status;
    entry.response = text.substring(0, 500);
    console.log(`[Webhook] ${eventType} sent. Status: ${response.status}`);
    addWebhookHistory(entry);
    return { status: response.status, body: text };
  } catch (err) {
    entry.error = err.message;
    console.error(`[Webhook] Failed ${eventType}:`, err.message);
    addWebhookHistory(entry);
    return null;
  }
}

// ============================================
// AUTO-STAGE RULES
// ============================================
function checkAutoStageRules(lead, trigger) {
  const oldStage = lead.stage;
  let changed = false;

  if (trigger === 'outreach_sent' && lead.stage === 'cold') {
    lead.stage = 'contacted';
    changed = true;
  }

  if (trigger === 'calendar_event_added' && ['cold', 'contacted', 'qualified'].includes(lead.stage)) {
    lead.stage = 'call_booked';
    changed = true;
  }

  if (changed) {
    const newStageLabel = STAGES.find(s => s.id === lead.stage)?.label || lead.stage;
    const oldStageLabel = STAGES.find(s => s.id === oldStage)?.label || oldStage;
    lead.activity.push({
      type: 'stage_change',
      message: `Stage auto-changed from ${oldStageLabel} to ${newStageLabel}`,
      from: oldStage,
      to: lead.stage,
      timestamp: new Date().toISOString()
    });

    sendWebhookNotification('lead_stage_changed', {
      lead_id: lead.id,
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      emails: lead.emails,
      phones: lead.phones,
      industry: lead.industry,
      old_stage: oldStage,
      new_stage: lead.stage,
      deal_value: lead.deal_value,
      auto_rule: true
    }).catch(err => console.error('[Webhook] Error:', err));
  }

  return changed;
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Source, X-API-Key, X-Event-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Static files
app.use('/static', express.static(path.join(__dirname, 'public', 'static')));
app.use('/uploads', express.static(UPLOADS_DIR));

// File upload configs
const csvUpload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });
const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|csv|txt|mp4|mp3)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// ============================================
// SESSION AUTH
// ============================================
const activeSessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getTokenFromReq(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/lead_token=([^;]+)/);
  return match ? match[1] : null;
}

function isAuthenticated(req) {
  const token = getTokenFromReq(req);
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.created > 86400000) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login');
}

function requireApiOrSession(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (API_KEY) {
    const provided = req.headers['x-api-key'] || req.query.api_key;
    if (provided === API_KEY) return next();
  }
  if (!API_KEY && req.path.startsWith('/api/')) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ============================================
// AUTH ROUTES
// ============================================
app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = generateToken();
    activeSessions.set(token, { user: username, created: Date.now() });
    res.setHeader('Set-Cookie', `lead_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  const token = getTokenFromReq(req);
  if (token) activeSessions.delete(token);
  res.setHeader('Set-Cookie', 'lead_token=; Path=/; HttpOnly; Max-Age=0');
  res.redirect('/login');
});

// ============================================
// PAGE ROUTES (protected)
// ============================================
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/lead/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lead-detail.html'));
});

app.get('/new', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lead-form.html'));
});

app.get('/edit/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lead-form.html'));
});

app.get('/industry/:industry', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/import', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'import.html'));
});

app.get('/dev', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dev.html'));
});

// ============================================
// API: STAGES, INDUSTRIES, SOURCES (config)
// ============================================
app.get('/api/stages', (req, res) => {
  res.json({ stages: STAGES });
});

app.get('/api/industries', (req, res) => {
  res.json({ industries: getIndustries() });
});

app.post('/api/industries', requireAuth, (req, res) => {
  const { industries } = req.body;
  if (!Array.isArray(industries)) return res.status(400).json({ error: 'industries array required' });
  setIndustries(industries);
  return res.json({ success: true, industries });
});

app.get('/api/sources', (req, res) => {
  res.json({ sources: DEFAULT_SOURCES });
});

// ============================================
// API: LEADS CRUD
// ============================================

// List leads
app.get('/api/leads', requireApiOrSession, (req, res) => {
  try {
    let leads = getAllLeads();
    const { industry, stage, tag, search, source, sort, order } = req.query;

    if (industry) {
      if (industry.toLowerCase() === 'other') {
        // 'Other' matches leads with no industry or with a custom industry not in the default list
        const defaultSet = new Set(getIndustries().map(i => i.toLowerCase()));
        leads = leads.filter(l => !l.industry || !defaultSet.has(l.industry.toLowerCase()));
      } else {
        leads = leads.filter(l => l.industry && l.industry.toLowerCase() === industry.toLowerCase());
      }
    }
    if (stage) leads = leads.filter(l => l.stage === stage);
    if (tag) leads = leads.filter(l => l.tags && l.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
    if (source) leads = leads.filter(l => l.lead_source && l.lead_source.toLowerCase().includes(source.toLowerCase()));
    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(l =>
        (l.company_name || '').toLowerCase().includes(q) ||
        (l.contact_name || '').toLowerCase().includes(q) ||
        (l.emails || []).some(e => e.toLowerCase().includes(q)) ||
        (l.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (l.details || '').toLowerCase().includes(q) ||
        (l.address || '').toLowerCase().includes(q)
      );
    }

    // Recalculate scores
    leads.forEach(l => { l.lead_score = calculateLeadScore(l); });

    // Sort
    const sortField = sort || 'updated_at';
    const sortOrder = order === 'asc' ? 1 : -1;
    leads.sort((a, b) => {
      const av = a[sortField] || '';
      const bv = b[sortField] || '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortOrder;
      return String(av).localeCompare(String(bv)) * sortOrder;
    });

    return res.json({ leads, total: leads.length });
  } catch (err) {
    console.error('Error listing leads:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Check duplicates (POST - full check)
app.post('/api/leads/check-duplicates', requireApiOrSession, (req, res) => {
  const duplicates = findDuplicates(req.body);
  return res.json({ duplicates });
});

// Check duplicate (GET - simple check for lead form) — MUST be before /:id route
app.get('/api/leads/check-duplicate', requireApiOrSession, (req, res) => {
  const { company_name, email, exclude_id } = req.query;
  const allLeads = getAllLeads();
  
  for (const existing of allLeads) {
    if (exclude_id && existing.id === exclude_id) continue;
    
    // Check email match
    if (email && existing.emails && existing.emails.length > 0) {
      if (existing.emails.some(e => e.toLowerCase() === email.toLowerCase())) {
        return res.json({ duplicate: true, match_type: 'email', existing: { id: existing.id, company_name: existing.company_name, contact_name: existing.contact_name } });
      }
    }
    
    // Check company name match
    if (company_name && existing.company_name) {
      if (company_name.toLowerCase().trim() === existing.company_name.toLowerCase().trim()) {
        return res.json({ duplicate: true, match_type: 'company_name', existing: { id: existing.id, company_name: existing.company_name, contact_name: existing.contact_name } });
      }
    }
  }
  
  return res.json({ duplicate: false });
});

// Get single lead
app.get('/api/leads/:id', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  lead.lead_score = calculateLeadScore(lead);
  return res.json(lead);
});

// Create lead
app.post('/api/leads', requireApiOrSession, (req, res) => {
  try {
    const data = req.body;
    data._source = data._source || req.headers['x-source'] || 'api';

    const lead = createLeadObject(data);
    lead.activity.push({
      type: 'created',
      message: `Lead created from ${lead._source}`,
      timestamp: lead.created_at
    });
    lead.lead_score = calculateLeadScore(lead);

    writeLead(lead);
    console.log(`[${new Date().toISOString()}] Lead created: ${lead.id} (${lead.company_name})`);

    sendWebhookNotification('lead_created', {
      lead_id: lead.id,
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      emails: lead.emails,
      phones: lead.phones,
      industry: lead.industry,
      stage: lead.stage,
      lead_source: lead.lead_source,
      deal_value: lead.deal_value
    }).catch(err => console.error('[Webhook] Error:', err));

    return res.json({ success: true, lead });
  } catch (err) {
    console.error('Error creating lead:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Full update
app.put('/api/leads/:id', requireApiOrSession, (req, res) => {
  const existing = readLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  try {
    const data = req.body;
    const oldStage = existing.stage;

    // Preserve internal fields
    const notes = existing.notes || [];
    const activity = existing.activity || [];
    const outreach = existing.outreach || [];
    const attachments = existing.attachments || [];
    const createdAt = existing.created_at;

    Object.assign(existing, createLeadObject(data));
    existing.id = req.params.id;
    existing.notes = notes;
    existing.activity = activity;
    existing.outreach = outreach;
    existing.attachments = attachments;
    existing.created_at = createdAt;
    existing.updated_at = new Date().toISOString();
    existing.lead_score = calculateLeadScore(existing);

    if (data.stage && data.stage !== oldStage) {
      existing.activity.push({
        type: 'stage_change',
        message: `Stage changed from ${STAGES.find(s => s.id === oldStage)?.label || oldStage} to ${STAGES.find(s => s.id === data.stage)?.label || data.stage}`,
        from: oldStage,
        to: data.stage,
        timestamp: existing.updated_at
      });
    }

    writeLead(existing);
    return res.json({ success: true, lead: existing });
  } catch (err) {
    console.error('Error updating lead:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Partial update
app.patch('/api/leads/:id', requireApiOrSession, (req, res) => {
  const existing = readLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  try {
    const data = req.body;
    const oldStage = existing.stage;

    // Merge fields
    const fields = ['company_name', 'contact_name', 'emails', 'phones', 'website', 'linkedin',
      'address', 'industry', 'company_size', 'revenue_estimate', 'lead_source', 'tags',
      'stage', 'assigned_to', 'deal_value', 'details', 'next_followup', 'proposal_url', 'custom_fields'];

    fields.forEach(f => {
      if (data[f] !== undefined) existing[f] = data[f];
    });

    existing.updated_at = new Date().toISOString();

    if (data.stage && data.stage !== oldStage) {
      if (!existing.activity) existing.activity = [];
      existing.activity.push({
        type: 'stage_change',
        message: `Stage changed from ${STAGES.find(s => s.id === oldStage)?.label || oldStage} to ${STAGES.find(s => s.id === data.stage)?.label || data.stage}`,
        from: oldStage,
        to: data.stage,
        timestamp: existing.updated_at
      });

      sendWebhookNotification('lead_stage_changed', {
        lead_id: existing.id,
        company_name: existing.company_name,
        contact_name: existing.contact_name,
        emails: existing.emails,
        phones: existing.phones,
        industry: existing.industry,
        old_stage: oldStage,
        new_stage: existing.stage,
        deal_value: existing.deal_value
      }).catch(err => console.error('[Webhook] Error:', err));
    }

    existing.lead_score = calculateLeadScore(existing);
    writeLead(existing);
    return res.json({ success: true, lead: existing });
  } catch (err) {
    console.error('Error patching lead:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete lead
app.delete('/api/leads/:id', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  deleteLead(req.params.id);
  console.log(`[${new Date().toISOString()}] Lead deleted: ${req.params.id}`);
  return res.json({ success: true, message: `Lead ${req.params.id} deleted` });
});

// ============================================
// API: BULK ACTIONS
// ============================================
app.post('/api/leads/bulk/stage', requireAuth, (req, res) => {
  const { ids, stage } = req.body;
  if (!Array.isArray(ids) || !stage) return res.status(400).json({ error: 'ids (array) and stage required' });
  if (!STAGES.find(s => s.id === stage)) return res.status(400).json({ error: 'Invalid stage' });

  let updated = 0;
  ids.forEach(id => {
    const lead = readLead(id);
    if (lead && lead.stage !== stage) {
      const oldStage = lead.stage;
      lead.stage = stage;
      lead.updated_at = new Date().toISOString();
      if (!lead.activity) lead.activity = [];
      lead.activity.push({
        type: 'stage_change',
        message: `Stage changed to ${STAGES.find(s => s.id === stage).label} (bulk)`,
        from: oldStage,
        to: stage,
        timestamp: lead.updated_at
      });
      lead.lead_score = calculateLeadScore(lead);
      writeLead(lead);
      updated++;
    }
  });

  return res.json({ success: true, updated });
});

app.post('/api/leads/bulk/delete', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids (array) required' });
  let deleted = 0;
  ids.forEach(id => { if (readLead(id)) { deleteLead(id); deleted++; } });
  return res.json({ success: true, deleted });
});

app.post('/api/leads/bulk/tag', requireAuth, (req, res) => {
  const { ids, tag, action } = req.body;
  if (!Array.isArray(ids) || !tag) return res.status(400).json({ error: 'ids (array) and tag required' });
  let updated = 0;
  ids.forEach(id => {
    const lead = readLead(id);
    if (lead) {
      if (!lead.tags) lead.tags = [];
      if (action === 'remove') {
        lead.tags = lead.tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
      } else {
        if (!lead.tags.some(t => t.toLowerCase() === tag.toLowerCase())) lead.tags.push(tag);
      }
      lead.updated_at = new Date().toISOString();
      writeLead(lead);
      updated++;
    }
  });
  return res.json({ success: true, updated });
});

// ============================================
// API: NOTES (Rich text with HTML content)
// ============================================
app.post('/api/leads/:id/notes', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const { content, type, title } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const note = {
    id: uuidv4(),
    title: title || '',
    content: content,  // Can be HTML from rich text editor
    type: type || 'note',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (!lead.notes) lead.notes = [];
  lead.notes.unshift(note);

  if (!lead.activity) lead.activity = [];
  const plainText = content.replace(/<[^>]*>/g, '');
  lead.activity.push({
    type: 'note_added',
    message: `Note added: ${plainText.substring(0, 80)}${plainText.length > 80 ? '...' : ''}`,
    note_id: note.id,
    timestamp: note.created_at
  });

  lead.last_contacted = note.created_at;
  lead.updated_at = note.created_at;
  lead.lead_score = calculateLeadScore(lead);
  writeLead(lead);

  return res.json({ success: true, note });
});

// Update note
app.put('/api/leads/:id/notes/:noteId', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const note = (lead.notes || []).find(n => n.id === req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  if (req.body.content !== undefined) note.content = req.body.content;
  if (req.body.title !== undefined) note.title = req.body.title;
  if (req.body.type !== undefined) note.type = req.body.type;
  note.updated_at = new Date().toISOString();

  lead.updated_at = new Date().toISOString();
  writeLead(lead);

  return res.json({ success: true, note });
});

app.delete('/api/leads/:id/notes/:noteId', requireAuth, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.notes) return res.status(404).json({ error: 'Note not found' });
  lead.notes = lead.notes.filter(n => n.id !== req.params.noteId);
  lead.updated_at = new Date().toISOString();
  writeLead(lead);
  return res.json({ success: true });
});

// ============================================
// API: OUTREACH TRACKING
// ============================================
app.get('/api/leads/:id/outreach', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  return res.json({ outreach: lead.outreach || [] });
});

app.post('/api/leads/:id/outreach', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const { direction, subject, body, channel, template_name, from_email, to_email } = req.body;
  if (!direction || !body) return res.status(400).json({ error: 'direction and body required' });

  const entry = {
    id: uuidv4(),
    direction: direction, // 'sent' or 'received'
    channel: channel || 'email',
    subject: subject || '',
    body: body,
    from_email: from_email || '',
    to_email: to_email || '',
    template_name: template_name || '',
    timestamp: new Date().toISOString()
  };

  if (!lead.outreach) lead.outreach = [];
  lead.outreach.unshift(entry);

  if (!lead.activity) lead.activity = [];
  lead.activity.push({
    type: 'outreach',
    message: `${direction === 'sent' ? 'Email sent' : 'Email received'}: ${subject || '(no subject)'}`,
    outreach_id: entry.id,
    timestamp: entry.timestamp
  });

  lead.last_contacted = entry.timestamp;
  lead.updated_at = entry.timestamp;

  // Auto-stage rule: if outreach sent and stage is cold, move to contacted
  if (direction === 'sent') {
    checkAutoStageRules(lead, 'outreach_sent');
  }

  lead.lead_score = calculateLeadScore(lead);
  writeLead(lead);

  return res.json({ success: true, outreach: entry });
});

app.delete('/api/leads/:id/outreach/:outreachId', requireAuth, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.outreach) return res.status(404).json({ error: 'Outreach not found' });
  lead.outreach = lead.outreach.filter(o => o.id !== req.params.outreachId);
  lead.updated_at = new Date().toISOString();
  writeLead(lead);
  return res.json({ success: true });
});

// ============================================
// API: FILE ATTACHMENTS
// ============================================
app.post('/api/leads/:id/attachments', requireAuth, fileUpload.single('file'), (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const attachment = {
    id: uuidv4(),
    filename: req.file.originalname,
    stored_name: req.file.filename,
    url: '/uploads/' + req.file.filename,
    mime_type: req.file.mimetype,
    size: req.file.size,
    uploaded_at: new Date().toISOString()
  };

  if (!lead.attachments) lead.attachments = [];
  lead.attachments.push(attachment);

  if (!lead.activity) lead.activity = [];
  lead.activity.push({
    type: 'attachment',
    message: `File attached: ${req.file.originalname}`,
    attachment_id: attachment.id,
    timestamp: attachment.uploaded_at
  });

  lead.updated_at = attachment.uploaded_at;
  writeLead(lead);

  return res.json({ success: true, attachment });
});

app.delete('/api/leads/:id/attachments/:attachmentId', requireAuth, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const att = (lead.attachments || []).find(a => a.id === req.params.attachmentId);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  // Delete file
  const filePath = path.join(UPLOADS_DIR, att.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  lead.attachments = lead.attachments.filter(a => a.id !== req.params.attachmentId);
  lead.updated_at = new Date().toISOString();
  writeLead(lead);

  return res.json({ success: true });
});

// Upload image for notes (rich text editor)
app.post('/api/upload/image', requireAuth, fileUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  return res.json({ success: true, url: '/uploads/' + req.file.filename });
});

// ============================================
// API: CALENDAR EVENT
// ============================================
app.post('/api/leads/:id/calendar', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const { event_id, title, start_time, end_time, meet_link, description, attendees } = req.body;

  lead.calendar_event = {
    event_id: event_id || '',
    title: title || 'Call with ' + (lead.contact_name || lead.company_name),
    start_time: start_time || '',
    end_time: end_time || '',
    meet_link: meet_link || '',
    description: description || '',
    attendees: attendees || [],
    updated_at: new Date().toISOString()
  };

  if (!lead.activity) lead.activity = [];
  lead.activity.push({
    type: 'call_booked',
    message: `Call booked: ${lead.calendar_event.title} on ${start_time || 'TBD'}`,
    timestamp: new Date().toISOString()
  });

  lead.updated_at = new Date().toISOString();

  // Auto-stage rule
  checkAutoStageRules(lead, 'calendar_event_added');

  lead.lead_score = calculateLeadScore(lead);
  writeLead(lead);

  sendWebhookNotification('lead_call_booked', {
    lead_id: lead.id,
    company_name: lead.company_name,
    contact_name: lead.contact_name,
    emails: lead.emails,
    calendar_event: lead.calendar_event
  }).catch(err => console.error('[Webhook] Error:', err));

  return res.json({ success: true, calendar_event: lead.calendar_event });
});

// ============================================
// API: EMAIL TEMPLATES
// ============================================
app.get('/api/email-templates', requireAuth, (req, res) => {
  return res.json({ templates: getEmailTemplates() });
});

app.post('/api/email-templates', requireAuth, (req, res) => {
  const { name, subject, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name and body required' });

  const templates = getEmailTemplates();
  const template = { id: uuidv4(), name, subject: subject || '', body, created_at: new Date().toISOString() };
  templates.push(template);
  saveEmailTemplates(templates);

  return res.json({ success: true, template });
});

app.put('/api/email-templates/:id', requireAuth, (req, res) => {
  const templates = getEmailTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template not found' });

  if (req.body.name) templates[idx].name = req.body.name;
  if (req.body.subject !== undefined) templates[idx].subject = req.body.subject;
  if (req.body.body) templates[idx].body = req.body.body;
  templates[idx].updated_at = new Date().toISOString();

  saveEmailTemplates(templates);
  return res.json({ success: true, template: templates[idx] });
});

app.delete('/api/email-templates/:id', requireAuth, (req, res) => {
  let templates = getEmailTemplates();
  templates = templates.filter(t => t.id !== req.params.id);
  saveEmailTemplates(templates);
  return res.json({ success: true });
});

// ============================================
// API: CSV EXPORT
// ============================================
app.get('/api/export/csv', requireAuth, (req, res) => {
  try {
    const leads = getAllLeads();
    const { industry, stage } = req.query;

    let filtered = leads;
    if (industry) {
      if (industry.toLowerCase() === 'other') {
        const defaultSet = new Set(getIndustries().map(i => i.toLowerCase()));
        filtered = filtered.filter(l => !l.industry || !defaultSet.has(l.industry.toLowerCase()));
      } else {
        filtered = filtered.filter(l => l.industry && l.industry.toLowerCase() === industry.toLowerCase());
      }
    }
    if (stage) filtered = filtered.filter(l => l.stage === stage);

    const headers = [
      'ID', 'Company Name', 'Contact Name', 'Emails', 'Phones', 'Website', 'LinkedIn',
      'Address', 'Industry', 'Company Size', 'Revenue Estimate', 'Lead Source', 'Tags',
      'Stage', 'Assigned To', 'Deal Value', 'Details', 'Last Contacted', 'Next Follow-up',
      'Proposal URL', 'Lead Score', 'Created At', 'Updated At'
    ];

    const rows = filtered.map(l => [
      l.id, csvEscape(l.company_name), csvEscape(l.contact_name),
      csvEscape((l.emails || []).join('; ')), csvEscape((l.phones || []).join('; ')),
      csvEscape(l.website), csvEscape(l.linkedin), csvEscape(l.address),
      csvEscape(l.industry), csvEscape(l.company_size), csvEscape(l.revenue_estimate),
      csvEscape(l.lead_source), csvEscape((l.tags || []).join('; ')),
      l.stage, csvEscape(l.assigned_to), l.deal_value || 0,
      csvEscape(l.details), l.last_contacted || '', l.next_followup || '',
      csvEscape(l.proposal_url), calculateLeadScore(l), l.created_at, l.updated_at
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="flowtier-leads-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

function csvEscape(val) {
  if (!val) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ============================================
// API: CSV IMPORT (with column mapping)
// ============================================
// Step 1: Upload CSV and get headers + preview
app.post('/api/import/csv/preview', requireAuth, csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'CSV must have header + at least 1 row' });
    }

    const headers = parseCSVLine(lines[0]).map(h => h.trim());
    const preview = [];
    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
      preview.push(row);
    }

    return res.json({
      success: true,
      file_path: req.file.path,
      headers,
      preview,
      total_rows: lines.length - 1
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: 'Failed to parse CSV: ' + err.message });
  }
});

// Step 2: Import with column mapping
app.post('/api/import/csv/execute', requireAuth, (req, res) => {
  const { file_path, mapping, default_industry, custom_industry, default_stage, default_source } = req.body;

  if (!file_path || !mapping) return res.status(400).json({ error: 'file_path and mapping required' });
  if (!fs.existsSync(file_path)) return res.status(400).json({ error: 'File not found. Please re-upload.' });

  try {
    const content = fs.readFileSync(file_path, 'utf8');
    fs.unlinkSync(file_path); // cleanup

    const lines = content.split('\n').filter(l => l.trim());
    const headers = parseCSVLine(lines[0]).map(h => h.trim());
    const imported = [];
    const skipped = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

      const data = {};

      // Apply mapping
      Object.keys(mapping).forEach(field => {
        const csvCol = mapping[field];
        if (csvCol && row[csvCol] !== undefined) {
          data[field] = row[csvCol];
        }
      });

      // Handle industry
      if (default_industry === '_custom' && custom_industry) {
        data.industry = custom_industry;
      } else if (default_industry && default_industry !== '_from_csv') {
        data.industry = default_industry;
      }

      // Handle arrays
      if (data.emails && typeof data.emails === 'string') {
        data.emails = data.emails.split(/[;,]/).map(e => e.trim()).filter(Boolean);
      }
      if (data.phones && typeof data.phones === 'string') {
        data.phones = data.phones.split(/[;,]/).map(p => p.trim()).filter(Boolean);
      }
      if (data.tags && typeof data.tags === 'string') {
        data.tags = data.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean);
      }

      data.stage = default_stage || 'cold';
      data.lead_source = default_source || 'CSV Import';
      data._source = 'csv_import';
      data.deal_value = parseFloat(data.deal_value) || 0;

      if (data.company_name || data.contact_name) {
        const lead = createLeadObject(data);
        lead.activity.push({
          type: 'created',
          message: 'Imported from CSV',
          timestamp: lead.created_at
        });
        lead.lead_score = calculateLeadScore(lead);
        writeLead(lead);
        imported.push(lead.id);
      } else {
        skipped.push(i);
      }
    }

    console.log(`[${new Date().toISOString()}] CSV import: ${imported.length} leads, ${skipped.length} skipped`);
    return res.json({ success: true, imported: imported.length, skipped: skipped.length, ids: imported });
  } catch (err) {
    console.error('CSV import error:', err);
    return res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// Legacy direct import (for Make.com)
app.post('/api/import/csv', requireAuth, csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);

    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least 1 row' });

    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const imported = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

      const data = {
        company_name: row['company name'] || row['company_name'] || row['company'] || '',
        contact_name: row['contact name'] || row['contact_name'] || row['name'] || row['contact'] || '',
        emails: (row['emails'] || row['email'] || '').split(';').map(e => e.trim()).filter(Boolean),
        phones: (row['phones'] || row['phone'] || '').split(';').map(p => p.trim()).filter(Boolean),
        website: row['website'] || row['url'] || '',
        linkedin: row['linkedin'] || row['linkedin url'] || '',
        address: row['address'] || '',
        industry: row['industry'] || '',
        company_size: row['company size'] || row['company_size'] || row['size'] || '',
        revenue_estimate: row['revenue estimate'] || row['revenue_estimate'] || row['revenue'] || '',
        lead_source: row['lead source'] || row['lead_source'] || row['source'] || 'CSV Import',
        tags: (row['tags'] || '').split(';').map(t => t.trim()).filter(Boolean),
        stage: row['stage'] || 'cold',
        assigned_to: row['assigned to'] || row['assigned_to'] || '',
        deal_value: parseFloat(row['deal value'] || row['deal_value'] || 0) || 0,
        details: row['details'] || row['enrichment'] || '',
        _source: 'csv_import'
      };

      if (data.company_name || data.contact_name) {
        const lead = createLeadObject(data);
        lead.activity.push({ type: 'created', message: 'Imported from CSV', timestamp: lead.created_at });
        lead.lead_score = calculateLeadScore(lead);
        writeLead(lead);
        imported.push(lead.id);
      }
    }

    return res.json({ success: true, imported: imported.length, ids: imported });
  } catch (err) {
    console.error('CSV import error:', err);
    return res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// JSON import
app.post('/api/import/json', requireApiOrSession, (req, res) => {
  try {
    let leads = req.body;
    if (!Array.isArray(leads)) leads = [leads];

    const imported = [];
    leads.forEach(data => {
      data._source = data._source || req.headers['x-source'] || 'json_import';
      const lead = createLeadObject(data);
      lead.activity.push({ type: 'created', message: `Imported from ${lead._source}`, timestamp: lead.created_at });
      lead.lead_score = calculateLeadScore(lead);
      writeLead(lead);
      imported.push(lead.id);
    });

    return res.json({ success: true, imported: imported.length, ids: imported });
  } catch (err) {
    console.error('JSON import error:', err);
    return res.status(500).json({ error: 'Import failed' });
  }
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

// ============================================
// API: PIPELINE STATS (enhanced)
// ============================================
app.get('/api/stats', requireApiOrSession, (req, res) => {
  try {
    const leads = getAllLeads();
    const now = new Date();

    const byStage = {};
    const byIndustry = {};
    const bySource = {};
    let totalDealValue = 0;
    let overdueFollowups = 0;
    let leadsThisWeek = 0;
    let leadsThisMonth = 0;
    let wonCount = 0;
    let totalLeadsExLost = 0;

    STAGES.forEach(s => { byStage[s.id] = { count: 0, deal_value: 0 }; });

    const weekAgo = new Date(now - 7 * 86400000).toISOString();
    const monthAgo = new Date(now - 30 * 86400000).toISOString();
    const statsDefaultIndSet = new Set(getIndustries().map(i => i.toLowerCase()));

    leads.forEach(l => {
      if (byStage[l.stage]) {
        byStage[l.stage].count++;
        byStage[l.stage].deal_value += (l.deal_value || 0);
      }
      const ind = (l.industry && statsDefaultIndSet.has(l.industry.toLowerCase())) ? l.industry : (l.industry || 'Other');
      if (!byIndustry[ind]) byIndustry[ind] = 0;
      byIndustry[ind]++;

      const src = l.lead_source || 'Unknown';
      if (!bySource[src]) bySource[src] = { count: 0, won: 0 };
      bySource[src].count++;
      if (l.stage === 'won') bySource[src].won++;

      totalDealValue += (l.deal_value || 0);

      if (l.next_followup && new Date(l.next_followup) < now && l.stage !== 'won' && l.stage !== 'lost') {
        overdueFollowups++;
      }

      if (l.created_at >= weekAgo) leadsThisWeek++;
      if (l.created_at >= monthAgo) leadsThisMonth++;

      if (l.stage === 'won') wonCount++;
      if (l.stage !== 'lost') totalLeadsExLost++;
    });

    const conversionRate = totalLeadsExLost > 0 ? Math.round((wonCount / totalLeadsExLost) * 100) : 0;
    const avgDealValue = leads.length > 0 ? Math.round(totalDealValue / leads.length) : 0;

    // Recent activity across all leads
    const recentActivity = [];
    leads.forEach(l => {
      (l.activity || []).forEach(a => {
        recentActivity.push({
          ...a,
          lead_id: l.id,
          company_name: l.company_name,
          contact_name: l.contact_name
        });
      });
    });
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({
      total_leads: leads.length,
      total_deal_value: totalDealValue,
      avg_deal_value: avgDealValue,
      conversion_rate: conversionRate,
      overdue_followups: overdueFollowups,
      leads_this_week: leadsThisWeek,
      leads_this_month: leadsThisMonth,
      by_stage: byStage,
      by_industry: byIndustry,
      by_source: bySource,
      recent_activity: recentActivity.slice(0, 20),
      stages: STAGES
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching stats' });
  }
});

// ============================================
// API: WEBHOOK CONFIG & HISTORY
// ============================================
app.get('/api/webhook-config', requireAuth, (req, res) => {
  return res.json({ url: getWebhookUrl() });
});

app.post('/api/webhook-config', requireAuth, (req, res) => {
  const { url } = req.body;
  setWebhookUrl(url || '');
  return res.json({ success: true });
});

app.get('/api/webhook-history', requireAuth, (req, res) => {
  return res.json({ history: getWebhookHistory() });
});

// ============================================
// API: DEV TEST WEBHOOK
// ============================================
app.post('/api/dev/test-webhook', async (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { event_type, payload } = req.body;
  if (!event_type || !payload) return res.status(400).json({ error: 'Missing event_type or payload' });

  const url = getWebhookUrl();
  if (!url) return res.json({ success: false, error: 'No webhook URL configured.' });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'flowtier-lead-system',
        'X-Event-Type': event_type,
        'X-Test': 'true'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    addWebhookHistory({
      id: uuidv4(),
      event_type,
      timestamp: new Date().toISOString(),
      url,
      status: response.status,
      response: text.substring(0, 500),
      test: true
    });

    return res.json({
      success: response.ok,
      webhook_status: response.status,
      webhook_response: text.substring(0, 500),
      error: response.ok ? null : `Webhook returned ${response.status}`
    });
  } catch (err) {
    return res.json({ success: false, error: `Failed to reach webhook: ${err.message}` });
  }
});

// ============================================
// CAMPAIGN SCHEDULER INSTANCE
// ============================================
const campaignScheduler = new CampaignScheduler(readLead, writeLead, addWebhookHistory);

// ============================================
// PAGE ROUTES: CAMPAIGNS
// ============================================
app.get('/campaigns', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'campaigns.html'));
});

app.get('/campaigns/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'campaign-detail.html'));
});

// ============================================
// API: CAMPAIGNS CRUD
// ============================================

// List all campaigns
app.get('/api/campaigns', requireApiOrSession, (req, res) => {
  const campaigns = getAllCampaigns();
  return res.json({ campaigns, total: campaigns.length });
});

// Get single campaign
app.get('/api/campaigns/:id', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  return res.json(campaign);
});

// Create campaign
app.post('/api/campaigns', requireApiOrSession, (req, res) => {
  try {
    const campaign = createCampaignObject(req.body);
    campaign.stats.total_leads = campaign.leads.length;
    writeCampaign(campaign);
    console.log(`[Campaign] Created: ${campaign.id} (${campaign.name})`);
    return res.json({ success: true, campaign });
  } catch (err) {
    console.error('Error creating campaign:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update campaign
app.patch('/api/campaigns/:id', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const fields = ['name', 'description', 'webhook_url', 'schedule', 'steps'];
  fields.forEach(f => {
    if (req.body[f] !== undefined) campaign[f] = req.body[f];
  });
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  // If active, restart with new settings
  if (campaign.status === 'active') {
    campaignScheduler.stopCampaign(campaign.id);
    campaignScheduler.startCampaign(campaign.id);
  }

  return res.json({ success: true, campaign });
});

// Delete campaign
app.delete('/api/campaigns/:id', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  campaignScheduler.stopCampaign(req.params.id);
  deleteCampaignFile(req.params.id);
  return res.json({ success: true });
});

// ============================================
// API: CAMPAIGN LEADS
// ============================================

// Import leads into campaign
app.post('/api/campaigns/:id/leads', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { lead_ids } = req.body;
  if (!Array.isArray(lead_ids)) return res.status(400).json({ error: 'lead_ids array required' });

  const existingIds = new Set(campaign.leads.map(l => l.lead_id));
  let added = 0;

  lead_ids.forEach(id => {
    if (existingIds.has(id)) return; // skip duplicates
    const lead = readLead(id);
    if (!lead) return;

    let primaryEmail = (lead.emails || [])[0];
    // Handle nested arrays (e.g., [['email@example.com']])
    if (Array.isArray(primaryEmail)) primaryEmail = primaryEmail[0];
    if (!primaryEmail || typeof primaryEmail !== 'string') return; // skip leads without email

    // Check blacklist
    if (isBlacklisted(primaryEmail)) return;

    campaign.leads.push({
      lead_id: id,
      email: primaryEmail,
      status: 'pending', // pending, sent, waiting, completed, replied, bounced, opted_out, blacklisted, error
      current_step: 1,
      last_sent_at: null,
      sent_count: 0,
      last_step_sent: 0,
      paused: false,
      added_at: new Date().toISOString()
    });
    added++;
  });

  campaign.stats.total_leads = campaign.leads.length;
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  return res.json({ success: true, added, total: campaign.leads.length });
});

// Remove lead from campaign
app.delete('/api/campaigns/:id/leads/:leadId', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  campaign.leads = campaign.leads.filter(l => l.lead_id !== req.params.leadId);
  campaign.stats.total_leads = campaign.leads.length;
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  return res.json({ success: true });
});

// Pause/unpause a lead in campaign
app.patch('/api/campaigns/:id/leads/:leadId', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const entry = campaign.leads.find(l => l.lead_id === req.params.leadId);
  if (!entry) return res.status(404).json({ error: 'Lead not in campaign' });

  if (req.body.paused !== undefined) entry.paused = req.body.paused;
  if (req.body.status !== undefined) entry.status = req.body.status;
  if (req.body.current_step !== undefined) entry.current_step = req.body.current_step;

  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  return res.json({ success: true, entry });
});

// ============================================
// API: CAMPAIGN STEPS (sequence)
// ============================================
app.post('/api/campaigns/:id/steps', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { steps } = req.body;
  if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps array required' });

  campaign.steps = steps.map((s, i) => ({
    id: s.id || uuidv4(),
    step_number: i + 1,
    subject_template: s.subject_template || '',
    body_template: s.body_template || '',
    delay_days: s.delay_days || (i === 0 ? 0 : 3),
    active: s.active !== false
  }));

  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  return res.json({ success: true, steps: campaign.steps });
});

// ============================================
// API: CAMPAIGN CONTROL (start/pause/resume)
// ============================================
app.post('/api/campaigns/:id/start', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  if (!campaign.webhook_url) {
    return res.status(400).json({ error: 'Webhook URL is required to start a campaign' });
  }
  if (campaign.leads.length === 0) {
    return res.status(400).json({ error: 'Add leads to the campaign before starting' });
  }
  if (campaign.steps.length === 0 || !campaign.steps.some(s => s.active)) {
    return res.status(400).json({ error: 'At least one active email step is required' });
  }

  campaign.status = 'active';
  campaign.started_at = campaign.started_at || new Date().toISOString();
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  campaignScheduler.startCampaign(campaign.id);

  return res.json({ success: true, status: 'active' });
});

app.post('/api/campaigns/:id/pause', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  campaign.status = 'paused';
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  campaignScheduler.stopCampaign(campaign.id);

  return res.json({ success: true, status: 'paused' });
});

// ============================================
// API: CAMPAIGN CALLBACKS (from Make.com)
// ============================================

// Log that an email was actually sent (callback from Make.com)
app.post('/api/campaigns/:id/log-send', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { lead_id, subject, body, from_email, step_number } = req.body;
  const entry = campaign.leads.find(l => l.lead_id === lead_id);
  if (!entry) return res.status(404).json({ error: 'Lead not in campaign' });

  // Log on the lead
  const lead = readLead(lead_id);
  if (lead) {
    if (!lead.outreach) lead.outreach = [];
    lead.outreach.unshift({
      id: uuidv4(),
      direction: 'sent',
      channel: 'email',
      subject: subject || '',
      body: body || '',
      from_email: from_email || '',
      to_email: entry.email,
      campaign_id: campaign.id,
      campaign_step: step_number || entry.last_step_sent,
      timestamp: new Date().toISOString()
    });

    if (!lead.activity) lead.activity = [];
    lead.activity.push({
      type: 'outreach',
      message: `Campaign "${campaign.name}" email confirmed sent: ${subject || '(no subject)'}`,
      campaign_id: campaign.id,
      timestamp: new Date().toISOString()
    });

    lead.last_contacted = new Date().toISOString();
    lead.updated_at = new Date().toISOString();

    // Auto-stage: cold -> contacted
    if (lead.stage === 'cold') {
      checkAutoStageRules(lead, 'outreach_sent');
    }

    writeLead(lead);
  }

  return res.json({ success: true });
});

// Log a reply from a lead (from Make.com mailbox watcher)
app.post('/api/campaigns/:id/reply', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { lead_id, email, subject, body, from_email } = req.body;

  // Find lead in campaign by lead_id or email
  let entry;
  if (lead_id) {
    entry = campaign.leads.find(l => l.lead_id === lead_id);
  }
  if (!entry && email) {
    entry = campaign.leads.find(l => l.email.toLowerCase() === email.toLowerCase());
  }
  if (!entry && from_email) {
    entry = campaign.leads.find(l => l.email.toLowerCase() === from_email.toLowerCase());
  }

  if (!entry) return res.status(404).json({ error: 'Lead not found in campaign. Provide lead_id or matching email.' });

  // Auto-pause: stop sending to this lead
  entry.status = 'replied';
  campaign.stats.replies_received++;
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  // Log on the lead
  const lead = readLead(entry.lead_id);
  if (lead) {
    if (!lead.outreach) lead.outreach = [];
    lead.outreach.unshift({
      id: uuidv4(),
      direction: 'received',
      channel: 'email',
      subject: subject || '',
      body: body || '',
      from_email: from_email || entry.email,
      to_email: '',
      campaign_id: campaign.id,
      timestamp: new Date().toISOString()
    });

    if (!lead.activity) lead.activity = [];
    lead.activity.push({
      type: 'outreach',
      message: `Reply received from ${entry.email}: ${subject || '(no subject)'}`,
      campaign_id: campaign.id,
      timestamp: new Date().toISOString()
    });

    lead.last_contacted = new Date().toISOString();
    lead.updated_at = new Date().toISOString();

    // Auto-stage: move to qualified if contacted
    if (lead.stage === 'contacted') {
      const oldStage = lead.stage;
      lead.stage = 'qualified';
      lead.activity.push({
        type: 'stage_change',
        message: 'Stage auto-changed from Contacted to Qualified (reply received)',
        from: oldStage,
        to: 'qualified',
        timestamp: new Date().toISOString()
      });
    }

    writeLead(lead);
  }

  return res.json({ success: true, message: 'Reply logged. Lead paused in campaign.' });
});

// Log a bounce
app.post('/api/campaigns/:id/bounce', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { lead_id, email, reason } = req.body;

  let entry;
  if (lead_id) entry = campaign.leads.find(l => l.lead_id === lead_id);
  if (!entry && email) entry = campaign.leads.find(l => l.email.toLowerCase() === email.toLowerCase());

  if (!entry) return res.status(404).json({ error: 'Lead not found in campaign' });

  entry.status = 'bounced';
  campaign.stats.bounces++;
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  // Add to blacklist
  addToBlacklist(entry.email, reason || 'Bounced');

  // Log on lead
  const lead = readLead(entry.lead_id);
  if (lead) {
    if (!lead.activity) lead.activity = [];
    lead.activity.push({
      type: 'bounce',
      message: `Email bounced: ${entry.email} — ${reason || 'Unknown reason'}`,
      campaign_id: campaign.id,
      timestamp: new Date().toISOString()
    });
    lead.updated_at = new Date().toISOString();
    writeLead(lead);
  }

  return res.json({ success: true, message: 'Bounce logged. Email blacklisted.' });
});

// Opt-out a lead
app.post('/api/campaigns/:id/opt-out', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { lead_id, email } = req.body;
  let entry;
  if (lead_id) entry = campaign.leads.find(l => l.lead_id === lead_id);
  if (!entry && email) entry = campaign.leads.find(l => l.email.toLowerCase() === email.toLowerCase());

  if (!entry) return res.status(404).json({ error: 'Lead not found in campaign' });

  entry.status = 'opted_out';
  campaign.stats.opted_out++;
  campaign.updated_at = new Date().toISOString();
  writeCampaign(campaign);

  addToBlacklist(entry.email, 'Opted out');

  return res.json({ success: true });
});

// ============================================
// API: CAMPAIGN ANALYTICS
// ============================================
app.get('/api/campaigns/:id/analytics', requireApiOrSession, (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const statusCounts = {};
  campaign.leads.forEach(l => {
    statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  });

  const stepStats = campaign.steps.map(step => {
    const sentInStep = campaign.leads.filter(l => l.last_step_sent >= step.step_number).length;
    return {
      step_number: step.step_number,
      subject: step.subject_template,
      sent: sentInStep,
      delay_days: step.delay_days
    };
  });

  const replyRate = campaign.stats.emails_sent > 0
    ? Math.round((campaign.stats.replies_received / campaign.stats.emails_sent) * 100)
    : 0;

  const bounceRate = campaign.stats.emails_sent > 0
    ? Math.round((campaign.stats.bounces / campaign.stats.emails_sent) * 100)
    : 0;

  return res.json({
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    status: campaign.status,
    total_leads: campaign.leads.length,
    emails_sent: campaign.stats.emails_sent,
    replies_received: campaign.stats.replies_received,
    bounces: campaign.stats.bounces,
    opted_out: campaign.stats.opted_out,
    reply_rate: replyRate,
    bounce_rate: bounceRate,
    sends_today: campaign.stats.sends_today,
    daily_limit: campaign.schedule.daily_limit,
    status_breakdown: statusCounts,
    step_stats: stepStats,
    started_at: campaign.started_at,
    completed_at: campaign.completed_at
  });
});

// ============================================
// API: CONVERSATION HISTORY (for AI agent)
// ============================================
app.get('/api/leads/:id/conversations', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Combine outreach into chronological conversation
  const conversations = (lead.outreach || [])
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(o => ({
      direction: o.direction,
      channel: o.channel,
      subject: o.subject,
      body: o.body,
      from_email: o.from_email,
      to_email: o.to_email,
      campaign_id: o.campaign_id || null,
      campaign_step: o.campaign_step || null,
      timestamp: o.timestamp
    }));

  // Include notes for context
  const notes = (lead.notes || []).map(n => ({
    title: n.title,
    content: n.content ? n.content.replace(/<[^>]*>/g, '') : '',
    type: n.type,
    created_at: n.created_at
  }));

  return res.json({
    lead_id: lead.id,
    contact_name: lead.contact_name,
    company_name: lead.company_name,
    emails: lead.emails,
    phones: lead.phones,
    industry: lead.industry,
    website: lead.website,
    stage: lead.stage,
    details: lead.details,
    conversations,
    notes,
    total_messages: conversations.length
  });
});

// ============================================
// API: BLACKLIST
// ============================================
app.get('/api/blacklist', requireAuth, (req, res) => {
  return res.json({ blacklist: getBlacklist() });
});

app.post('/api/blacklist', requireApiOrSession, (req, res) => {
  const { email, reason } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const list = addToBlacklist(email, reason);
  return res.json({ success: true, total: list.length });
});

app.delete('/api/blacklist/:email', requireAuth, (req, res) => {
  const list = removeFromBlacklist(decodeURIComponent(req.params.email));
  return res.json({ success: true, total: list.length });
});

// ============================================
// API: CAMPAIGN CLONE
// ============================================
app.post('/api/campaigns/:id/clone', requireApiOrSession, (req, res) => {
  const original = readCampaign(req.params.id);
  if (!original) return res.status(404).json({ error: 'Campaign not found' });

  const clone = createCampaignObject({
    name: ((req.body && req.body.name) || original.name) + ' (Copy)',
    description: original.description,
    webhook_url: original.webhook_url,
    schedule: JSON.parse(JSON.stringify(original.schedule)),
    steps: original.steps.map(s => ({
      subject_template: s.subject_template,
      body_template: s.body_template,
      delay_days: s.delay_days,
      active: s.active
    }))
  });

  writeCampaign(clone);
  return res.json({ success: true, campaign: clone });
});

// ============================================
// API: SEND TEST EMAIL (single lead, for testing)
// ============================================
app.post('/api/campaigns/:id/test-send', requireAuth, async (req, res) => {
  const campaign = readCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!campaign.webhook_url) return res.status(400).json({ error: 'No webhook URL configured' });

  const { lead_id, step_number } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const lead = readLead(lead_id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const step = campaign.steps.find(s => s.step_number === (step_number || 1));
  if (!step) return res.status(400).json({ error: 'Step not found' });

  const entry = campaign.leads.find(l => l.lead_id === lead_id) || {
    lead_id,
    email: (lead.emails || [])[0] || ''
  };

  const result = await campaignScheduler.fireEmailWebhook(campaign, entry, step, lead);

  return res.json({
    success: result ? result.success : false,
    webhook_status: result ? result.status : null,
    webhook_response: result ? result.body?.substring(0, 500) : null,
    test: true
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  FlowTier Lead Management System v2.0   │
  │  Running on port ${PORT}                    │
  │                                         │
  │  Dashboard: http://localhost:${PORT}/        │
  │  API:       http://localhost:${PORT}/api/...  │
  │  Dev:       http://localhost:${PORT}/dev      │
  │  Campaigns: http://localhost:${PORT}/campaigns │
  └─────────────────────────────────────────┘
  `);

  // Resume active campaigns
  campaignScheduler.resumeActiveCampaigns();
});
