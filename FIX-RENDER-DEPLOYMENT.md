# Fix Render Deployment Configuration

## Problem from Your Screenshot
Your Render service "MAET-1" has:
- ❌ Build: `yarn` (should use `bun install`)
- ❌ Start: `yarn start` (should use `bun run start`)
- ❌ Root Directory: empty (should be `server`)
- ❌ Not connected to GitHub for auto-deploy

## Step 1: Update Render Service Configuration

### Go to: https://dashboard.render.com/web/srv-d8vpp89o3t8c73bisvg

1. **Click "Edit"** in the service settings

### Fix Settings:
```
Service Name: stock-market-backend

Root Directory: server

Build Command: cd .. && bun install --frozen-lockfile && cd server && bun run build

Start Command: bun run start

Runtime: Node.js 20
```

## Step 2: Connect to GitHub Auto-Deploy

1. **Click "Integrations"** tab
2. **Click "New +"** → **GitLab** or **GitHub**
3. Select repository: `tanmay-alpha/MAET`
4. Make sure it's on branch: `main`
5. **Enable auto-deploy**

## Step 3: Set Environment Variables

Copy these from your local `.env`:
```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
UPSTASH_REDIS_URL=
ANGELONE_MASTER_KEY=
ANGELONE_API_KEY=
ANGELONE_CLIENT_ID=
ANGELONE_PIN=
ANGELONE_TOTP_SECRET=
ALERT_WEBHOOK_URL=
NSE_HOLIDAYS_JSON=
FRONTEND_ORIGIN=https://maet-pi.vercel.app,https://maet-tanmay-alphas-projects.vercel.app,https://maet-tanmay-alpha-tanmay-alphas-projects.vercel.app
```

## Step 4: Redeploy

1. **Click "Redeploy"**
2. Wait for build
3. Check health: `https://your-service-url.onrender.com/api/health`

## Verify After Fix

After redeployment, you should see:
- Build logs showing `bun install` and `bun run build`
- Start command: `bun run start`
- Health check passing
- Auto-deploy on every push to main

## Current Vercel Status (Should be fine)
- Frontend is deployed
- Latest commits are there
- Working correctly

## Why This Happened
The Render service was created before we had the proper `render.yaml` configuration. It was using default settings instead of the explicit YAML config.