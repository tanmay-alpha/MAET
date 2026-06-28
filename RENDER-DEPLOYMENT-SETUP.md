# Render Deployment - Complete Guide

## ✅ What's Already Done

### 1. GitHub Workflow Created
- File: `.github/workflows/deploy-render.yml`
- Purpose: Trigger Render deployment on push to main
- Status: ✅ Pushed to main branch

### 2. Render Configuration Ready
- File: `render.yaml` 
- Service: `stock-market-backend`
- Runtime: Node 20
- Build: `bun install && bun run build` (from server/)
- Start: `bun run start`
- Health Check: `/api/health`

### 3. Setup Script Added
- File: `scripts/setup-render.sh`
- Purpose: Verify Render configuration and show setup steps

## 🔗 Link Repository to Render (Manual - 2 minutes)

### Step 1: Open Render Dashboard
https://dashboard.render.com

### Step 2: Connect GitHub
1. Click **New +** → **Web Service**
2. Connect GitHub account (if not connected)
3. Select repository: **tanmay-alpha/MAET**
4. Render will auto-detect `render.yaml`

### Step 3: Verify Auto-Detected Settings
- **Root Directory:** `server`
- **Build Command:** Auto-filled from render.yaml
- **Start Command:** Auto-filled from render.yaml
- **Node Version:** 20

## 🔑 Set Environment Variables (Manual - 3 minutes)

Copy these from your local `.env` to Render dashboard:

```bash
# Supabase (auth + DB)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Redis (idempotency, rate limit, bus)
UPSTASH_REDIS_URL=rediss://xxx...

# AngelOne credentials
ANGELONE_MASTER_KEY=base64encodedkey...
ANGELONE_API_KEY=your_api_key
ANGELONE_CLIENT_ID=your_client_id
ANGELONE_PIN=your_pin
ANGELONE_TOTP_SECRET=your_totp_secret

# Optional webhook
ALERT_WEBHOOK_URL=https://...

# NSE holidays (JSON array)
NSE_HOLIDAYS_JSON=["2026-01-26",...]

# CORS: Allow Vercel frontend origins
FRONTEND_ORIGIN=https://maet-pi.vercel.app,https://maet-tanmay-alphas-projects.vercel.app,https://maet-tanmay-alpha-tanmay-alphas-projects.vercel.app
```

## 🚀 Deploy (Automatic after setup)

Once configured:
- Every push to `main` triggers deployment
- Build logs show in Render dashboard
- Health check: `https://stock-market-backend-xxx.onrender.com/api/health`

## 🧪 Test Deployment

After first deploy completes:

```bash
# Test health endpoint
curl https://<your-service-url>.onrender.com/api/health

# Test market endpoint
curl https://<your-service-url>.onrender.com/api/market/quotes?symbols=RELIANCE

# Check deployment logs in Render dashboard
```

## 📊 Monitor Deployment

1. **Render Dashboard:** https://dashboard.render.com
2. **Service Logs:** Real-time logs and events
3. **Health Status:** Auto-monitored via `/api/health`
4. **GitHub Actions:** `.github/workflows/deploy-render.yml`

## 🔄 Deployment Workflow

```
git push to main
    ↓
GitHub Action triggers
    ↓
Render auto-deploys (if connected)
    ↓
Build: bun install → bun run build
    ↓
Start: bun run start
    ↓
Health Check: /api/health
    ↓
✅ Live
```

## 🐛 Troubleshooting

### Build Fails
- Check Render build logs
- Verify `server/package.json` has correct scripts
- Ensure bun runtime is available

### Service Won't Start
- Check environment variables are set
- Verify `HOST=0.0.0.0` in start command
- Check health endpoint responds

### API Errors
- Verify CORS origins include Vercel domains
- Check Supabase credentials are valid
- Test locally first: `cd server && bun run dev`

---

**Status:** Ready for Render deployment
**Next Step:** Connect repository to Render dashboard
**Time:** 5 minutes to complete setup