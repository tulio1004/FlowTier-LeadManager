/* ============================================
   SERVER.JS — FlowTier Lead Management System
   Express server for leads.flowtier.io
   ============================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_DIR = path.join(__dirname, 'config');

// Auth credentials
const ADMIN_USER = process.env.ADMIN_USER || 'tulio';
const ADMIN_PASS = process.env.ADMIN_PASS || '25524515Fl0wT13r';
const API_KEY = process.env.API_KEY || null;

// Ensure directories exist
[DATA_DIR, CONFIG_DIR].forEach(dir => {
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
// DEFAULT INDUSTRIES
// ============================================
const DEFAULT_INDUSTRIES = [
  'Dental', 'Healthcare', 'Real Estate', 'Legal', 'Financial Services',
  'Insurance', 'Home Services', 'Restaurants', 'E-commerce', 'SaaS',
  'Marketing Agency', 'Construction', 'Education', 'Fitness', 'Other'
];

// ============================================
// PERSISTENT CONFIG HELPERS
// ============================================
const WEBHOOK_CONFIG_FILE = path.join(CONFIG_DIR, 'webhook.json');
const INDUSTRIES_FILE = path.join(CONFIG_DIR, 'industries.json');

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
    industry: data.industry || 'Other',
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
    activity: Array.isArray(data.activity) ? data.activity : [],
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
    console.log(`[Webhook] ${eventType} sent. Status: ${response.status}`);
    return { status: response.status, body: text };
  } catch (err) {
    console.error(`[Webhook] Failed ${eventType}:`, err.message);
    return null;
  }
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Source, X-API-Key, X-Event-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Static files
app.use('/static', express.static(path.join(__dirname, 'public', 'static')));

// File upload for CSV
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

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

// API key auth for external API calls
function requireApiOrSession(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (API_KEY) {
    const provided = req.headers['x-api-key'] || req.query.api_key;
    if (provided === API_KEY) return next();
  }
  // Allow unauthenticated API access if no API_KEY is set (for Make.com)
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

app.get('/dev', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dev.html'));
});

// ============================================
// API: STAGES & INDUSTRIES (config)
// ============================================
app.get('/api/stages', (req, res) => {
  res.json({ stages: STAGES });
});

app.get('/api/industries', (req, res) => {
  res.json({ industries: getIndustries() });
});

app.post('/api/industries', requireAuth, (req, res) => {
  const { industries } = req.body;
  if (!Array.isArray(industries)) return res.status(400).json({ error: 'Industries must be an array' });
  setIndustries(industries);
  res.json({ success: true, industries });
});

// ============================================
// API: WEBHOOK CONFIG
// ============================================
app.get('/api/webhook-config', requireAuth, (req, res) => {
  res.json({ url: getWebhookUrl() });
});

app.post('/api/webhook-config', requireAuth, (req, res) => {
  const { url } = req.body;
  if (typeof url !== 'string') return res.status(400).json({ error: 'URL must be a string' });
  setWebhookUrl(url.trim());
  res.json({ success: true, url: url.trim() });
});

// ============================================
// API: LEADS CRUD
// ============================================

// List all leads (with optional filters)
app.get('/api/leads', requireApiOrSession, (req, res) => {
  try {
    let leads = getAllLeads();

    // Filters
    const { industry, stage, tag, search, source, assigned_to, sort, order } = req.query;

    if (industry) leads = leads.filter(l => l.industry && l.industry.toLowerCase() === industry.toLowerCase());
    if (stage) leads = leads.filter(l => l.stage === stage);
    if (tag) leads = leads.filter(l => l.tags && l.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
    if (source) leads = leads.filter(l => l.lead_source && l.lead_source.toLowerCase().includes(source.toLowerCase()));
    if (assigned_to) leads = leads.filter(l => l.assigned_to && l.assigned_to.toLowerCase().includes(assigned_to.toLowerCase()));

    if (search) {
      const s = search.toLowerCase();
      leads = leads.filter(l =>
        (l.company_name && l.company_name.toLowerCase().includes(s)) ||
        (l.contact_name && l.contact_name.toLowerCase().includes(s)) ||
        (l.emails && l.emails.some(e => e.toLowerCase().includes(s))) ||
        (l.phones && l.phones.some(p => p.includes(s))) ||
        (l.tags && l.tags.some(t => t.toLowerCase().includes(s))) ||
        (l.details && l.details.toLowerCase().includes(s))
      );
    }

    // Sort
    const sortField = sort || 'updated_at';
    const sortOrder = order === 'asc' ? 1 : -1;
    leads.sort((a, b) => {
      const va = a[sortField] || '';
      const vb = b[sortField] || '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortOrder;
      return String(va).localeCompare(String(vb)) * sortOrder;
    });

    // Summary stats
    const stats = {
      total: leads.length,
      by_stage: {}
    };
    STAGES.forEach(s => { stats.by_stage[s.id] = 0; });
    leads.forEach(l => {
      if (stats.by_stage[l.stage] !== undefined) stats.by_stage[l.stage]++;
    });

    return res.json({ leads, stats });
  } catch (err) {
    console.error('Error listing leads:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single lead
app.get('/api/leads/:id', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  return res.json(lead);
});

// Create lead
app.post('/api/leads', requireApiOrSession, (req, res) => {
  try {
    const data = req.body;
    data._source = req.headers['x-source'] || data._source || 'api';
    const lead = createLeadObject(data);

    // Add creation activity
    lead.activity.push({
      type: 'created',
      message: `Lead created from ${lead._source}`,
      timestamp: lead.created_at
    });

    writeLead(lead);
    console.log(`[${new Date().toISOString()}] Lead created: ${lead.id} — ${lead.company_name}`);

    sendWebhookNotification('lead_created', {
      lead_id: lead.id,
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      emails: lead.emails,
      phones: lead.phones,
      industry: lead.industry,
      stage: lead.stage,
      lead_source: lead.lead_source
    }).catch(err => console.error('[Webhook] Error:', err));

    return res.status(201).json({ success: true, lead });
  } catch (err) {
    console.error('Error creating lead:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update lead (full replace)
app.put('/api/leads/:id', requireApiOrSession, (req, res) => {
  const existing = readLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  try {
    const data = req.body;
    data.id = existing.id;
    data.created_at = existing.created_at;
    data.notes = data.notes || existing.notes;
    data.activity = data.activity || existing.activity;

    const lead = createLeadObject(data);

    // Track stage change
    if (existing.stage !== lead.stage) {
      const oldStage = STAGES.find(s => s.id === existing.stage);
      const newStage = STAGES.find(s => s.id === lead.stage);
      lead.activity.push({
        type: 'stage_change',
        message: `Stage changed from ${oldStage ? oldStage.label : existing.stage} to ${newStage ? newStage.label : lead.stage}`,
        from: existing.stage,
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
        old_stage: existing.stage,
        new_stage: lead.stage,
        deal_value: lead.deal_value
      }).catch(err => console.error('[Webhook] Error:', err));
    }

    writeLead(lead);
    return res.json({ success: true, lead });
  } catch (err) {
    console.error('Error updating lead:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Partial update (PATCH)
app.patch('/api/leads/:id', requireApiOrSession, (req, res) => {
  const existing = readLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  try {
    const updates = req.body;
    const oldStage = existing.stage;

    // Merge updates
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at') {
        existing[key] = updates[key];
      }
    });
    existing.updated_at = new Date().toISOString();

    // Track stage change
    if (oldStage !== existing.stage) {
      const oldS = STAGES.find(s => s.id === oldStage);
      const newS = STAGES.find(s => s.id === existing.stage);
      if (!existing.activity) existing.activity = [];
      existing.activity.push({
        type: 'stage_change',
        message: `Stage changed from ${oldS ? oldS.label : oldStage} to ${newS ? newS.label : existing.stage}`,
        from: oldStage,
        to: existing.stage,
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

// Bulk stage update
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
      writeLead(lead);
      updated++;
    }
  });

  return res.json({ success: true, updated });
});

// Bulk delete
app.post('/api/leads/bulk/delete', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids (array) required' });

  let deleted = 0;
  ids.forEach(id => {
    if (readLead(id)) {
      deleteLead(id);
      deleted++;
    }
  });

  return res.json({ success: true, deleted });
});

// Bulk tag
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
        if (!lead.tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
          lead.tags.push(tag);
        }
      }
      lead.updated_at = new Date().toISOString();
      writeLead(lead);
      updated++;
    }
  });

  return res.json({ success: true, updated });
});

// ============================================
// API: NOTES
// ============================================
app.post('/api/leads/:id/notes', requireApiOrSession, (req, res) => {
  const lead = readLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const { content, type } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const note = {
    id: uuidv4(),
    content: content.trim(),
    type: type || 'note',
    created_at: new Date().toISOString()
  };

  if (!lead.notes) lead.notes = [];
  lead.notes.unshift(note);

  if (!lead.activity) lead.activity = [];
  lead.activity.push({
    type: 'note_added',
    message: `Note added: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`,
    note_id: note.id,
    timestamp: note.created_at
  });

  lead.last_contacted = note.created_at;
  lead.updated_at = note.created_at;
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
// API: CALENDAR EVENT (for Call Booked stage)
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
// API: CSV EXPORT
// ============================================
app.get('/api/export/csv', requireAuth, (req, res) => {
  try {
    const leads = getAllLeads();
    const { industry, stage } = req.query;

    let filtered = leads;
    if (industry) filtered = filtered.filter(l => l.industry && l.industry.toLowerCase() === industry.toLowerCase());
    if (stage) filtered = filtered.filter(l => l.stage === stage);

    // CSV header
    const headers = [
      'ID', 'Company Name', 'Contact Name', 'Emails', 'Phones', 'Website', 'LinkedIn',
      'Address', 'Industry', 'Company Size', 'Revenue Estimate', 'Lead Source', 'Tags',
      'Stage', 'Assigned To', 'Deal Value', 'Details', 'Last Contacted', 'Next Follow-up',
      'Proposal URL', 'Created At', 'Updated At'
    ];

    const rows = filtered.map(l => [
      l.id,
      csvEscape(l.company_name),
      csvEscape(l.contact_name),
      csvEscape((l.emails || []).join('; ')),
      csvEscape((l.phones || []).join('; ')),
      csvEscape(l.website),
      csvEscape(l.linkedin),
      csvEscape(l.address),
      csvEscape(l.industry),
      csvEscape(l.company_size),
      csvEscape(l.revenue_estimate),
      csvEscape(l.lead_source),
      csvEscape((l.tags || []).join('; ')),
      l.stage,
      csvEscape(l.assigned_to),
      l.deal_value || 0,
      csvEscape(l.details),
      l.last_contacted || '',
      l.next_followup || '',
      csvEscape(l.proposal_url),
      l.created_at,
      l.updated_at
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
// API: CSV IMPORT
// ============================================
app.post('/api/import/csv', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path); // cleanup

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
        industry: row['industry'] || 'Other',
        company_size: row['company size'] || row['company_size'] || row['size'] || '',
        revenue_estimate: row['revenue estimate'] || row['revenue_estimate'] || row['revenue'] || '',
        lead_source: row['lead source'] || row['lead_source'] || row['source'] || 'csv_import',
        tags: (row['tags'] || '').split(';').map(t => t.trim()).filter(Boolean),
        stage: row['stage'] || 'cold',
        assigned_to: row['assigned to'] || row['assigned_to'] || '',
        deal_value: parseFloat(row['deal value'] || row['deal_value'] || 0) || 0,
        details: row['details'] || row['enrichment'] || '',
        _source: 'csv_import'
      };

      if (data.company_name || data.contact_name) {
        const lead = createLeadObject(data);
        lead.activity.push({
          type: 'created',
          message: 'Imported from CSV',
          timestamp: lead.created_at
        });
        writeLead(lead);
        imported.push(lead.id);
      }
    }

    console.log(`[${new Date().toISOString()}] CSV import: ${imported.length} leads`);
    return res.json({ success: true, imported: imported.length, ids: imported });
  } catch (err) {
    console.error('CSV import error:', err);
    return res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// JSON import (for Make.com or paste)
app.post('/api/import/json', requireApiOrSession, (req, res) => {
  try {
    let leads = req.body;
    if (!Array.isArray(leads)) leads = [leads];

    const imported = [];
    leads.forEach(data => {
      data._source = data._source || req.headers['x-source'] || 'json_import';
      const lead = createLeadObject(data);
      lead.activity.push({
        type: 'created',
        message: `Imported from ${lead._source}`,
        timestamp: lead.created_at
      });
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
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ============================================
// API: PIPELINE STATS
// ============================================
app.get('/api/stats', requireApiOrSession, (req, res) => {
  try {
    const leads = getAllLeads();

    const byStage = {};
    const byIndustry = {};
    let totalDealValue = 0;

    STAGES.forEach(s => { byStage[s.id] = { count: 0, deal_value: 0 }; });

    leads.forEach(l => {
      if (byStage[l.stage]) {
        byStage[l.stage].count++;
        byStage[l.stage].deal_value += (l.deal_value || 0);
      }
      const ind = l.industry || 'Other';
      if (!byIndustry[ind]) byIndustry[ind] = 0;
      byIndustry[ind]++;
      totalDealValue += (l.deal_value || 0);
    });

    return res.json({
      total_leads: leads.length,
      total_deal_value: totalDealValue,
      by_stage: byStage,
      by_industry: byIndustry,
      stages: STAGES
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching stats' });
  }
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
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  FlowTier Lead Management System        │
  │  Running on port ${PORT}                    │
  │                                         │
  │  Dashboard: http://localhost:${PORT}/        │
  │  API:       http://localhost:${PORT}/api/...  │
  └─────────────────────────────────────────┘
  `);
});
