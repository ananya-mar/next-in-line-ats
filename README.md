# Next-In-Line ATS

A simple applicant tracking system to manage job applications with a queue-based approach.

## Quick Start

### Prerequisites
- Node.js
- PostgreSQL

### Setup

```bash
cd server && npm install
cd ../client && npm install

psql -U postgres -f server/migrations/001_init.sql

cd server && node index.js
cd client && npm run dev