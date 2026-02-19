#!/bin/bash
set -e

# ============================================================
# SEO Monitor - Deployment Script for Ubuntu 24.04 (Contabo)
# ============================================================
# Run as root or with sudo from the project directory

APP_DIR="/opt/seo-monitor"
DOMAIN="seo.le-guide-road-trip.fr"
PORT=3100

echo "=== SEO Monitor Deployment ==="

# 1. Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# 2. Create app directory
mkdir -p $APP_DIR

# 3. Copy .env.local first (needed for build)
if [ -f ".env.local" ]; then
    cp .env.local $APP_DIR/.env.local
elif [ ! -f "$APP_DIR/.env.local" ]; then
    echo "⚠️  No .env.local found. Create $APP_DIR/.env.local with your env vars first!"
    exit 1
fi

# 4. Install ALL dependencies (dev needed for build)
echo "Installing dependencies..."
npm ci

# 5. Build Next.js (standalone mode)
echo "Building Next.js (standalone)..."
npm run build

# 6. Copy standalone build + static assets to app dir
echo "Deploying to $APP_DIR..."
rm -rf $APP_DIR/.next
cp -r .next/standalone/* $APP_DIR/
cp -r .next/standalone/.next $APP_DIR/.next
cp -r .next/static $APP_DIR/.next/static
cp -r public $APP_DIR/public 2>/dev/null || true
cp ecosystem.config.cjs $APP_DIR/

# 7. Start with PM2
echo "Starting with PM2..."
cd $APP_DIR
pm2 delete seo-monitor 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# 8. Setup Nginx
echo "Setting up Nginx..."
cp /opt/seo-monitor-src/deploy/nginx-seo-monitor.conf /etc/nginx/sites-available/seo-monitor 2>/dev/null || true
ln -sf /etc/nginx/sites-available/seo-monitor /etc/nginx/sites-enabled/seo-monitor
nginx -t && systemctl reload nginx

# 9. Setup crontab
echo "Setting up cron jobs..."
CRON_SECRET=$(grep CRON_SECRET $APP_DIR/.env.local | cut -d= -f2)
(crontab -l 2>/dev/null | grep -v seo-monitor; cat << CRONEOF
# SEO Monitor - Daily position check (8:00 AM)
0 8 * * * curl -sf -m 600 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:$PORT/api/cron/check-positions >> /var/log/seo-monitor-cron.log 2>&1
# SEO Monitor - Daily indexation check (9:00 AM)
0 9 * * * curl -sf -m 600 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:$PORT/api/cron/check-indexation >> /var/log/seo-monitor-cron.log 2>&1
CRONEOF
) | crontab -

echo ""
echo "=== Done! ==="
echo "App running on port $PORT"
echo "URL: https://$DOMAIN"
echo "PM2 status: pm2 status"
echo "App logs: pm2 logs seo-monitor"
echo "Cron logs: tail -f /var/log/seo-monitor-cron.log"
