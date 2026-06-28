#!/bin/bash

# MAET Render Deployment Setup Script
# This script helps set up the Render deployment

echo "🚀 MAET Render Deployment Setup"
echo "================================"
echo ""

# Check if we're on the right branch
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "⚠️  Warning: You're not on main branch"
  echo "   Switch to main with: git checkout main"
fi

echo ""
echo "📋 Render Configuration Check:"
echo "--------------------------------"

# Check render.yaml exists
if [ -f "render.yaml" ]; then
  echo "✅ render.yaml found"
  echo ""
  echo "Service Details:"
  grep -A 3 "name:" render.yaml | head -4
  grep "runtime:" render.yaml
  grep "buildCommand:" render.yaml
  grep "startCommand:" render.yaml
  grep "healthCheckPath:" render.yaml
else
  echo "❌ render.yaml not found"
  exit 1
fi

echo ""
echo "🔗 Next Steps to Complete Deployment:"
echo "-------------------------------------"
echo "1. Open Render Dashboard: https://dashboard.render.com"
echo "2. Connect GitHub repository: tanmay-alpha/MAET"
echo "3. Create Web Service using render.yaml"
echo "4. Set environment variables (see .env.example)"
echo ""
echo "Required Environment Variables:"
echo "-------------------------------"
cat .env.example | grep -v "^#" | grep "="
echo ""
echo "⏳ Once configured, Render will auto-deploy on git push to main"
echo ""
echo "🌐 Backend Health Check (after deployment):"
echo "   https://<your-service-url>.onrender.com/api/health"