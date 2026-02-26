# FlowTier Lead Management System v2.0 - Documentation

**Author:** Manus AI
**Date:** February 25, 2026

## 1. Introduction

This document provides comprehensive documentation for the FlowTier Lead Management System, a self-hosted, file-based CRM designed for Make.com integration and efficient lead tracking. It covers system architecture, deployment, API reference, data models, and all user-facing features.

## 2. System Architecture

The system is a Node.js/Express application with a vanilla HTML/CSS/JavaScript frontend. It is designed to be lightweight, fast, and easy to deploy on a standard Linux VPS.

- **Backend:** Node.js, Express.js
- **Frontend:** HTML, CSS, JavaScript (no frameworks)
- **Data Storage:** File-based JSON. Each lead is a separate `.json` file in the `/data` directory. Configuration files (webhooks, industries) are stored in the `/config` directory.
- **Process Management:** PM2
- **Web Server:** Nginx (as a reverse proxy)
- **SSL:** Let's Encrypt (Certbot)

## 3. Deployment Guide

This guide covers deploying the Lead Management System on a fresh Ubuntu VPS, running it alongside the `proposals.flowtier.io` system.

### 3.1. Prerequisites

- A VPS running Ubuntu 22.04 or later.
- A domain name (`leads.flowtier.io`) pointed to your VPS IP address.
- Node.js and npm installed.
- Nginx and PM2 installed.

### 3.2. Installation Steps

1.  **Clone the Repository**

    SSH into your VPS and clone the repository. You will need a GitHub Personal Access Token (PAT) with `repo` scope to clone the private repository.

    ```bash
    # Replace YOUR_TOKEN_HERE with your GitHub PAT
    git clone https://tulio1004:YOUR_TOKEN_HERE@github.com/tulio1004/FlowTier-LeadManager.git leadmanager

    # Navigate into the project directory
    cd leadmanager

    # Install dependencies
    npm install
    ```

2.  **Configure Environment Variables**

    The system is configured using `ecosystem.config.js`. You can edit this file to change the port, admin credentials, or set an API key.

    ```javascript
    // ecosystem.config.js
    module.exports = {
      apps: [{
        name: 'leads',
        script: 'server.js',
        env: {
          PORT: 4000, // Internal port for the app
          ADMIN_USER: 'tulio', // Dashboard username
          ADMIN_PASS: '25524515Fl0wT13r', // Dashboard password
          API_KEY: null // Optional: set a key to protect API endpoints
        }
      }]
    };
    ```

3.  **Start the Application with PM2**

    PM2 will manage the application process, ensuring it runs continuously and restarts on failure.

    ```bash
    # Start the application
    pm2 start ecosystem.config.js

    # Save the process list to resurrect on reboot
    pm2 save
    ```

4.  **Configure Nginx Reverse Proxy**

    Create an Nginx configuration file to proxy requests from `leads.flowtier.io` to the Node.js application running on port 4000.

    ```bash
    # Create the Nginx config file
    sudo nano /etc/nginx/sites-available/leads.flowtier.io
    ```

    Paste the following configuration into the file:

    ```nginx
    server {
        listen 80;
        server_name leads.flowtier.io;

        location / {
            proxy_pass http://127.0.0.1:4000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```

    Enable the site and test the configuration:

    ```bash
    # Create a symbolic link to enable the site
    sudo ln -s /etc/nginx/sites-available/leads.flowtier.io /etc/nginx/sites-enabled/

    # Test the Nginx configuration for errors
    sudo nginx -t

    # Reload Nginx to apply the changes
    sudo systemctl reload nginx
    ```

5.  **Obtain SSL Certificate with Certbot**

    Secure your site with a free SSL certificate from Let's Encrypt.

    ```bash
    # Install Certbot if you haven't already
    sudo apt update && sudo apt install -y certbot python3-certbot-nginx

    # Obtain and install the certificate
    sudo certbot --nginx -d leads.flowtier.io --non-interactive --agree-tos -m your-email@example.com
    ```

    Certbot will automatically update your Nginx configuration to handle SSL and redirect HTTP traffic to HTTPS.

### 3.3. Service Management

-   **Check Status:** `pm2 status` or `pm2 list`
-   **View Logs:** `pm2 logs leads`
-   **Restart Service:** `pm2 restart leads`
-   **Stop Service:** `pm2 stop leads`

## 4. User Interface

The UI is divided into several key sections, accessible from the sidebar.

-   **Dashboard:** The main landing page featuring a Kanban board, pipeline value charts, quick stats, and a recent activity feed.
-   **Lead Detail Page:** A comprehensive view of a single lead, including all contact information, notes, outreach history, attachments, and activity timeline.
-   **Lead Creation/Edit Form:** Forms for creating new leads or editing existing ones.
-   **CSV Import:** A tool for bulk-importing leads from a CSV file with column mapping.
-   **Dev Console:** A developer-focused page for API documentation and webhook testing.

## 5. API Reference

The API is designed for easy integration with services like Make.com. All endpoints are prefixed with `/api`.

### 5.1. Authentication

-   **Session Auth:** Endpoints are accessible when logged into the dashboard.
-   **API Key Auth:** If `API_KEY` is set in `ecosystem.config.js`, you must include it in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`.

### 5.2. Lead Object

The core data object for a lead.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `String` | Unique UUIDv4 for the lead. |
| `company_name` | `String` | Name of the company. |
| `contact_name` | `String` | Primary contact person's name. |
| `emails` | `Array<String>` | List of email addresses. |
| `phones` | `Array<String>` | List of phone numbers. |
| `website` | `String` | Company website URL. |
| `linkedin` | `String` | LinkedIn profile URL. |
| `address` | `String` | Physical address. |
| `industry` | `String` | Industry category. |
| `company_size` | `String` | Estimated number of employees. |
| `revenue_estimate` | `String` | Estimated annual revenue. |
| `lead_source` | `String` | Where the lead came from. |
| `tags` | `Array<String>` | Flexible tags for categorization. |
| `stage` | `String` | Current stage in the pipeline (e.g., `cold`, `won`). |
| `deal_value` | `Number` | Estimated value of the potential deal. |
| `details` | `String` | General enrichment data or long-form details. |
| `notes` | `Array<Object>` | Rich text notes. See Note Object. |
| `outreach` | `Array<Object>` | Log of emails sent/received. See Outreach Object. |
| `attachments` | `Array<Object>` | Uploaded files. See Attachment Object. |
| `calendar_event` | `Object` | Details of a booked call. See Calendar Event Object. |
| `custom_fields` | `Object` | Key-value store for extra data. |
| `lead_score` | `Number` | Calculated score (0-100) indicating lead quality. |
| `created_at` | `String` | ISO 8601 timestamp of creation. |
| `updated_at` | `String` | ISO 8601 timestamp of last update. |

### 5.3. Endpoints

#### Leads

-   `GET /api/leads`: List all leads. Supports filtering via query parameters (`industry`, `stage`, `tag`, `search`, `source`).
-   `POST /api/leads`: Create a new lead.
-   `GET /api/leads/:id`: Retrieve a single lead.
-   `PUT /api/leads/:id`: Fully update a lead.
-   `PATCH /api/leads/:id`: Partially update a lead.
-   `DELETE /api/leads/:id`: Delete a lead.

#### Notes

-   `POST /api/leads/:id/notes`: Add a rich text note to a lead.
-   `PUT /api/leads/:id/notes/:noteId`: Update an existing note.
-   `DELETE /api/leads/:id/notes/:noteId`: Delete a note.

#### Outreach

-   `POST /api/leads/:id/outreach`: Log an email sent or received.
-   `GET /api/leads/:id/outreach`: Get all outreach history for a lead.
-   `DELETE /api/leads/:id/outreach/:outreachId`: Delete an outreach entry.

#### Attachments

-   `POST /api/leads/:id/attachments`: Upload a file attachment for a lead (form-data, `file` field).
-   `DELETE /api/leads/:id/attachments/:attachmentId`: Delete an attachment.

#### Calendar

-   `POST /api/leads/:id/calendar`: Add or update a Google Calendar event associated with a lead.

#### Bulk Actions

-   `POST /api/leads/bulk/stage`: Change the stage for multiple leads.
-   `POST /api/unstable_bulk/delete`: Delete multiple leads.
-   `POST /api/leads/bulk/tag`: Add or remove a tag from multiple leads.

#### CSV & JSON Import

-   `POST /api/import/csv/preview`: Upload a CSV to get headers and a data preview for mapping.
-   `POST /api/import/csv/execute`: Execute the import with the specified column mapping.
-   `POST /api/import/json`: Import leads from a JSON array.

#### Configuration

-   `GET /api/stages`: Get the list of all possible lead stages.
-   `GET /api/industries`: Get the list of all configured industries.
-   `GET /api/sources`: Get the list of all lead sources.
-   `GET /api/webhook-config`: Get the current webhook URL.
-   `POST /api/webhook-config`: Set the webhook URL.
-   `GET /api/webhook-history`: Get the last 100 webhook delivery logs.

## 6. Webhooks

The system can send webhook notifications to a configured URL (e.g., a Make.com webhook) for key events.

### 6.1. Events

-   `lead_created`: Fired when a new lead is created.
-   `lead_stage_changed`: Fired when a lead's stage is updated.
-   `lead_call_booked`: Fired when a calendar event is added to a lead.

### 6.2. Payload Structure

Each webhook payload contains the `event_type` and a data object relevant to the event.

**Example: `lead_stage_changed`**

```json
{
  "event_type": "lead_stage_changed",
  "payload": {
    "lead_id": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "company_name": "Example Corp",
    "old_stage": "cold",
    "new_stage": "contacted"
  }
}
```

## 7. Advanced Features

-   **Lead Scoring:** Automatically calculates a score from 0-100 based on data completeness, stage, and engagement.
-   **Duplicate Detection:** Checks for potential duplicates based on email, company name, and phone number when creating leads.
-   **Auto-Stage Rules:** Automatically moves leads to the next stage based on triggers (e.g., sending an outreach email moves a lead from `Cold` to `Contacted`).
-   **Rich Text Notes:** The notes editor supports full rich text formatting, including headings, lists, images, and code blocks.
-   **Kanban Drag-and-Drop:** Visually move leads between stages on the dashboard.

This documentation provides a complete overview of the FlowTier Lead Management System. For any further questions, please refer to the source code or the Dev Console within the application.

## 8. Campaign System

This section details the automated email campaign system, a major feature for proactive lead outreach. The system is designed to work in tandem with an external automation platform like Make.com, which handles the AI-powered email generation and sending.

### 8.1. Architecture & Flow

The campaign workflow is orchestrated between the CRM and Make.com:

1.  **Scheduling:** The CRM's internal scheduler checks every minute for campaigns that are due to send an email based on their defined frequency, time windows, and daily limits.
2.  **Webhook (`campaign_email_due`):** When an email is due for a specific lead in a sequence, the CRM fires a `campaign_email_due` webhook to the campaign-specific URL defined in its settings. This payload contains all necessary data: the lead's details, the full conversation history, and the email templates for the current step.
3.  **Make.com (Scenario 1 - Sending):**
    *   A Make.com scenario is triggered by this webhook.
    *   It uses an AI model (e.g., OpenAI) to generate a personalized email, using the provided lead data, conversation history, and templates as context.
    *   It sends the email via a connected Gmail, Outlook, or SMTP account.
    *   Upon successful sending, it makes a callback to the CRM's `/api/campaigns/:id/log-send` endpoint to record the send in the lead's activity timeline.
4.  **Make.com (Scenario 2 - Receiving Replies):**
    *   A separate Make.com scenario monitors the sending inbox for replies.
    *   When a reply is detected, it parses the email content (sender, subject, body).
    *   It posts the reply details to the CRM's `/api/campaigns/:id/reply` endpoint.
5.  **CRM (Reply Handling):** The CRM receives the reply, logs it in the lead's conversation history, automatically pauses the sequence for that lead to prevent further automated follow-ups, and updates the lead's stage (e.g., to "Qualified").

### 8.2. Campaign Data Model

The core data object for a campaign.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `String` | Unique UUIDv4 for the campaign. |
| `name` | `String` | The name of the campaign. |
| `description` | `String` | A short description of the campaign's purpose. |
| `status` | `String` | Current status: `draft`, `active`, `paused`, `completed`. |
| `webhook_url` | `String` | The Make.com webhook URL to which `campaign_email_due` events are sent. |
| `schedule` | `Object` | Contains the scheduling rules. See Schedule Object below. |
| `steps` | `Array<Object>` | The email sequence steps. See Step Object below. |
| `leads` | `Array<Object>` | A list of leads enrolled in the campaign, tracking their progress. |
| `stats` | `Object` | Analytics for the campaign (sends, replies, bounces, etc.). |
| `created_at` | `String` | ISO 8601 timestamp of creation. |
| `updated_at` | `String` | ISO 8601 timestamp of last update. |

#### Schedule Object

| Field | Type | Description |
| :--- | :--- | :--- |
| `frequency_minutes` | `Number` | The time in minutes to wait between sending emails to different leads. |
| `time_windows` | `Array<Object>` | An array of `{start: "HH:MM", end: "HH:MM"}` objects defining allowed sending times. |
| `timezone` | `String` | The IANA timezone for the schedule (e.g., "America/New_York"). |
| `daily_limit` | `Number` | The maximum number of emails to send per day for this campaign. |
| `days_of_week` | `Array<Number>` | Days of the week to send on (1=Monday, 7=Sunday). |

#### Step Object

| Field | Type | Description |
| :--- | :--- | :--- |
| `step_number` | `Number` | The order of the step in the sequence (1, 2, 3...). |
| `subject_template` | `String` | The template for the email subject line. Supports `{{variable}}` placeholders. |
| `body_template` | `String` | The template for the email body. Supports `{{variable}}` placeholders. |
| `delay_days` | `Number` | The number of days to wait after the previous step before sending this one. |
| `active` | `Boolean` | Whether this step is currently active. |

### 8.3. Campaign Endpoints

These endpoints manage the entire lifecycle of campaigns.

- `POST /api/campaigns`: Create a new campaign.
- `GET /api/campaigns`: List all campaigns.
- `GET /api/campaigns/:id`: Get full details for a single campaign.
- `PATCH /api/campaigns/:id`: Update a campaign's settings (name, schedule, etc.).
- `DELETE /api/campaigns/:id`: Delete a campaign.
- `POST /api/campaigns/:id/steps`: Add or update the email sequence steps for a campaign.
- `POST /api/campaigns/:id/leads`: Enroll one or more leads into a campaign.
- `DELETE /api/campaigns/:id/leads/:leadId`: Remove a lead from a campaign.
- `POST /api/campaigns/:id/start`: Start or resume a campaign.
- `POST /api/campaigns/:id/pause`: Pause an active campaign.
- `POST /api/campaigns/:id/clone`: Duplicate an existing campaign.
- `GET /api/campaigns/:id/analytics`: Retrieve detailed analytics for a campaign.

### 8.4. Make.com Callback Endpoints

These endpoints are designed to be called by your Make.com scenarios.

- `POST /api/campaigns/:id/log-send`: **Callback from Make.com.** Logs that an email was successfully sent to a lead for a specific step.
- `POST /api/campaigns/:id/reply`: **Callback from Make.com.** Logs a reply from a lead, pausing the sequence for them.
- `POST /api/campaigns/:id/bounce`: **Callback from Make.com.** Logs a bounced email, marking the lead as invalid.
- `POST /api/campaigns/:id/opt-out`: **Callback from Make.com.** Logs an unsubscribe request and adds the email to the global blacklist.

### 8.5. Conversation History & Blacklist

To provide full context to the AI agent and manage unsubscribes, two additional APIs are critical.

- `GET /api/leads/:id/conversations`: Retrieves the complete, chronologically ordered history of all messages sent and received for a specific lead. This is essential context for the AI to generate relevant and human-like follow-ups.
- `GET /api/blacklist`: Retrieves the list of all blacklisted email addresses.
- `POST /api/blacklist`: Adds a new email to the global blacklist.
- `DELETE /api/blacklist/:email`: Removes an email from the blacklist.
