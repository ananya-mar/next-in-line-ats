# Next-In-Line ATS

A simple applicant tracking system to manage job applications with a queue-based approach.

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install

# Database setup
# Ensure PostgreSQL is running, then:
psql -U postgres -c "CREATE DATABASE applications;"
psql -U postgres -d applications -f server/migrations/001_init.sql

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your database credentials

# Start backend (terminal 1)
cd server && node index.js

# Start frontend (terminal 2)
cd client && npm run dev
```

Access the app at `http://localhost:5173`

---

## Architecture

### System Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Express   │────▶│ PostgreSQL  │
│   (React)   │     │   Server    │     │   Database  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │            ┌──────┴──────┐
       │            │            │
       │     ┌──────┴─────┐ ┌────┴────────┐
       │     │  Routes    │ │ Services    │
       │     │ - jobs     │ │ - pipeline  │
       │     │ - apps     │ │ - decay     │
       │     └────────────┘ └─────────────┘
       │
       │ Vite Proxy (/api → localhost:4000)
       ▼
```

### Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | React + Vite | React 18, Vite 5 |
| Backend | Express.js | Node 22, Express 4 |
| Database | PostgreSQL | 14+ |
| ORM | pg (raw queries) | pg 8 |

### Database Schema

```sql
-- Jobs table
CREATE TABLE jobs (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  active_capacity INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Applications table
CREATE TABLE applications (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  applicant_name VARCHAR(255) NOT NULL,
  applicant_email VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  waitlist_position INTEGER,
  decay_penalty_count INTEGER DEFAULT 0,
  promoted_at TIMESTAMP,
  ack_deadline TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Pipeline audit log
CREATE TABLE pipeline_logs (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES applications(id),
  job_id INTEGER REFERENCES jobs(id),
  from_status VARCHAR(20),   -- NULL on first entry (initial application)
  to_status VARCHAR(20),
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Application States

```
┌─────────┐     ┌──────────────┐     ┌──────────┐
│ active  │────▶│ pending_ack  │────▶│  active  │
│         │     │ (24h window) │     │ (hired)  │
└─────────┘     └──────────────┘     └──────────┘
     ▲                  │                    │
     │                  ▼                    │
     │            ┌──────────┐               │
     └────────────│waitlisted│───────────────┘
                 (queue pos)
```

| State | Description |
|-------|-------------|
| `active` | Application under review, counts toward job's active capacity |
| `pending_ack` | Promoted from waitlist, awaiting applicant confirmation |
| `waitlisted` | No capacity available, in queue for next opening |
| `hired` | Applicant accepted, process complete |
| `rejected` | Application declined |
| `withdrawn` | Applicant withdrew |

Every state transition is written to `pipeline_logs` in the same database transaction as the status change — there is no way to update an application's status without a log entry being created. The full history of any application is always reconstructable from the log table alone.

---

## Configuration

### Timing Constants

| Setting | Value | Location |
|---------|-------|----------|
| Acknowledge window | 24 hours | `server/services/pipeline.js` |
| Decay scheduler interval | 60 seconds | `server/services/decayScheduler.js` |

### Environment Variables

```env
# server/.env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=applications
DB_USER=postgres
DB_PASSWORD=your_password
PORT=4000
```

---

## Queue Logic

### Promotion Algorithm

When a position opens (someone is hired/rejected/withdrawn):

1. **Check capacity** — Is there an open slot (`active_capacity - active_count > 0`)?
2. **Find next in queue** — Select applicant with lowest `waitlist_position`
3. **Set ack deadline** — 24 hours from now
4. **Change status** — `waitlisted` → `pending_ack`

### Decay Algorithm (Missed Acknowledgement)

If applicant doesn't acknowledge within 24 hours:

1. **Move to end of queue** — Reset position to `MAX(waitlist_position) + 1`
2. **Clear ack deadline** — Remove pending state
3. **Trigger promotion** — Fill the vacant slot

`decay_penalty_count` is incremented on each decay and stored on the application row. It isn't used for positioning — going to the back of the queue is penalty enough — but it's available for future rules like auto-rejecting after repeated non-response.

### Handling Simultaneous Applications (Last Available Slot)

When two requests arrive at the same time for the last open slot, both enter a database transaction that opens with `SELECT ... FOR UPDATE` on the job row. PostgreSQL's row-level lock means only one transaction evaluates capacity at a time — the second blocks until the first commits.

The first transaction sees a slot available and promotes the applicant to `pending_ack`. The second transaction then evaluates, finds capacity full, and assigns `waitlisted` with the next queue position. No double-booking, no extra infrastructure — the database handles it.

---

## API Endpoints

### Jobs

#### `POST /api/jobs`
Create a new job opening.

**Body:**
```json
{
  "title": "Backend Engineer",
  "company_name": "Acme Corp",
  "active_capacity": 3
}
```

**Response `201`:** the created job object.  
**Errors:** `400` if any field is missing or `active_capacity` is not a positive integer.

---

#### `GET /api/jobs/:id/pipeline`
Full pipeline state for the company dashboard. Returns the job and all applications, sorted by status (active → pending_ack → waitlisted by position → terminal).

**Response `200`:**
```json
{
  "job": { "id": 1, "title": "Backend Engineer", "active_capacity": 3 },
  "applications": [
    {
      "id": 10,
      "applicant_name": "Jane Smith",
      "status": "active",
      "waitlist_position": null,
      "ack_deadline": null
    },
    {
      "id": 11,
      "applicant_name": "John Doe",
      "status": "pending_ack",
      "waitlist_position": null,
      "ack_deadline": "2025-01-16T11:00:00Z"
    }
  ]
}
```

**Errors:** `404` if job not found.

---

### Applications

#### `POST /api/applications`
Submit a new application. Goes to `pending_ack` if a slot is open, `waitlisted` if not.

**Body:**
```json
{
  "job_id": 1,
  "applicant_name": "Jane Smith",
  "applicant_email": "jane@example.com"
}
```

**Response `201`:** the created application object including `status` and `waitlist_position`.  
**Errors:** `400` if fields are missing. `404` if job not found.

---

#### `GET /api/applications/:id/status`
Applicant self-check. Returns current status, queue position, and how many applicants are ahead.

**Response `200`:**
```json
{
  "id": 12,
  "applicant_name": "Jane Smith",
  "status": "waitlisted",
  "waitlist_position": 2,
  "ahead_in_queue": 1,
  "ack_deadline": null,
  "job_title": "Backend Engineer",
  "company_name": "Acme Corp"
}
```

**Errors:** `404` if application not found.

---

#### `POST /api/applications/:id/acknowledge`
Applicant confirms they're still interested after being promoted. Moves `pending_ack` → `active`.

**Response `200`:** `{ "success": true }`  
**Errors:** `400` if not in `pending_ack` state or window has expired. `404` if not found.

---

#### `POST /api/applications/:id/exit`
Company moves an applicant to a terminal state. Automatically triggers promotion of the next waitlisted applicant.

**Body:**
```json
{
  "status": "hired",
  "reason": "Strong system design round"
}
```

`status` must be one of: `hired`, `rejected`, `withdrawn`.

**Response `200`:** `{ "success": true }`  
**Errors:** `400` if status is invalid or applicant is not active. `404` if not found.

---

## Development History

### Day 1: Backend
- Set up Express server and connected PostgreSQL
- Designed and migrated full schema
- Built core pipeline service with capacity-aware promotion logic
- Implemented `SELECT FOR UPDATE` to handle concurrent applications safely
- Added full audit logging, every state transition written atomically
- Built decay scheduler from scratch:`setInterval` polling loop, no libraries
- Wired up all API routes

### Day 2: Frontend, Integration & Testing
- Built company dashboard showing live pipeline state with manual refresh
- Built applicant status page with queue position and acknowledge flow
- Connected frontend to backend via Vite proxy
- Tested full pipeline flow end to end — apply, promote, acknowledge, exit
- Tested decay cascade: verified waitlist moves automatically on missed acknowledgement
- Tested simultaneous application submissions against a single remaining slot
- Fixed edge cases and cleaned up error handling across routes

---

## Future Improvements

### With More Time

1. **Real-time updates**
   - Implement WebSocket for live dashboard refresh
   - Show applicants when they're promoted in real-time

2. **Email notifications**
   - Send SMTP emails on promotion/acknowledgement
   - Add reminder before ack deadline expires

3. **Analytics dashboard**
   - Track conversion rates by stage
   - Average wait time metrics
   - Decay rate by job

4. **Authentication**
   - Company login with JWT
   - Role-based access (admin vs recruiter)

5. **Search and filtering**
   - Filter applicants by status, date range
   - Full-text search on names/emails

6. **Bulk operations**
   - Select multiple applicants for batch actions
   - Export to CSV

7. **Persistent decay scheduling**
   - Move the scheduler out of the Express process into a `pg_cron` job or separate worker so decay processing survives server restarts

8. **Test coverage**
   - Unit tests for `promoteNext()` with mocked transactions
   - Integration test firing two simultaneous POST requests against a job with one slot, to verify the concurrency guarantee under real conditions

### Tradeoffs Made

| Decision | Tradeoff |
|----------|----------|
| Raw SQL over ORM | More verbose, but full control over queries and explicit transaction boundaries |
| `SELECT FOR UPDATE` for concurrency | Serialises writes per job row — correct at this scale, would need revisiting under high throughput |
| In-process decay scheduler | Simple, zero dependencies — but doesn't survive process restarts; a missed poll delays decay by at most 60 seconds |
| Decay = back of queue | Fair and simple; `decay_penalty_count` is tracked for future use but not applied to positioning |
| No authentication | Suitable for local use; production needs auth |
| Manual frontend refresh | Right call for a periodic-review workflow; auto-polling would add noise without benefit |

---