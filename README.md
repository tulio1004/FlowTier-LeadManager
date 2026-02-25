# FlowTier Lead Management System

Lead management system for **leads.flowtier.io** — built for automation-first workflows with Make.com integration.

## Features

- **Pipeline stages**: Cold → Contacted → Qualified → Call Booked → Proposal Sent → Won → Lost
- **Industry folders**: Organize leads by industry
- **Notes & call snapshots**: Rich note-taking with types (note, call_snapshot, follow_up, research)
- **Activity timeline**: Every action tracked with timestamps
- **Google Calendar integration**: Attach calendar events to leads
- **Full REST API**: Create, read, update, delete leads via API
- **Webhook notifications**: Receive events in Make.com when leads are created, stage changes, calls booked
- **CSV import/export**: Bulk data management
- **Bulk actions**: Change stage, add tags, or delete multiple leads at once
- **Dev Console**: Test webhooks and browse API documentation

## Stack

- Node.js + Express
- File-based JSON storage
- Vanilla HTML/CSS/JS frontend
- PM2 process manager
- Nginx reverse proxy

## Deployment

```bash
# On VPS
cd ~/leadmanager
npm install
pm2 start ecosystem.config.js
pm2 save
```

## Port: 4000
