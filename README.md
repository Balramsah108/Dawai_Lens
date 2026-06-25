# Dawai Lens MVP

An Indian-market Progressive Web App (PWA) that extracts medicines from prescription photos via an AI/OCR pipeline and compares prices across major Indian online pharmacies.

## Architecture

- **Frontend**: Next.js 14 (App Router) + React 18 + Tailwind CSS + TypeScript
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL 16
- **Storage**: Local file system (migrating to Cloudflare R2 later)
- **Caching**: In-memory (migrating to Redis later)

## Project Structure

```
dawai-lens/
├── frontend/          # Next.js 14 PWA
├── backend/           # Express.js API
├── dawaiLens-mvp/     # Spec files (requirements, design, tasks)
├── docker-compose.yml # PostgreSQL for local dev
└── package.json       # Monorepo workspace config
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd dawai-lens
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start PostgreSQL**
   ```bash
   docker-compose up -d
   ```

4. **Configure environment variables**
   
   Create `backend/.env`:
   ```env
   PORT=3001
   NODE_ENV=development
   DATABASE_URL=postgresql://dawailens:dev_password@localhost:5432/dawailens_dev
   UPLOAD_DIR=./uploads
   DEV_AUTH_SECRET=dev_secret_key_change_later
   ```

   Create `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

5. **Start development servers**
   ```bash
   npm run dev
   ```

   This runs both frontend (http://localhost:3000) and backend (http://localhost:3001) concurrently.

### Individual Commands

- **Frontend only**: `npm run dev:frontend`
- **Backend only**: `npm run dev:backend`
- **Build backend**: `npm run build --workspace=backend`
- **Build frontend**: `npm run build --workspace=frontend`

## Development Roadmap

See [`dawaiLens-mvp/tasks.md`](./dawaiLens-mvp/tasks.md) for the detailed implementation plan.

### Current Phase: Infrastructure Setup

- [x] Monorepo structure
- [x] Next.js 14 frontend with TypeScript and Tailwind
- [x] Express backend with TypeScript
- [x] PostgreSQL via Docker Compose
- [ ] Database schema and migrations
- [ ] Local file upload handling
- [ ] In-memory cache adapters

### Upcoming Phases

1. **OCR Pipeline** — Gemini Vision integration, drug name extraction
2. **Drug Normalization** — Fuzzy matching and Indian drug database
3. **Price Scraping** — Playwright scrapers for pharmacy platforms
4. **Comparison UI** — Price tables, sorting, generic suggestions
5. **User Accounts** — Firebase Auth, Rx History, Family Profiles
6. **PWA & Polish** — Service worker, manifest, legal pages

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test --workspace=backend
npm test --workspace=frontend
```

## 📚 Documentation

- [Requirements](./dawaiLens-mvp/requirements.md)
- [Design Document](./dawaiLens-mvp/design.md)
- [Implementation Tasks](./dawaiLens-mvp/tasks.md)

## 🔐 Security Notes

- Prescription images stored locally in `backend/uploads/` (not committed)
- Authentication currently uses dev tokens (Firebase Auth integration pending)
- No external services required for local development

## 🤝 Contributing

This is an MVP project. Follow the task list in `dawaiLens-mvp/tasks.md` for structured development.

## 📄 License

[Add your license here]

---

**Status**: 🚧 Active Development | **Version**: 0.1.0-alpha
