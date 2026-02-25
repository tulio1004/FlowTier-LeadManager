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
