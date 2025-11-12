# Netlify Deployment Guide

## Quick Deploy

Your project is now configured for Netlify deployment. Choose one of these methods:

### Option 1: Netlify CLI (Recommended)
```bash
# Install Netlify CLI globally (if not already installed)
npm install -g netlify-cli

# Deploy to production
netlify deploy --prod
```

### Option 2: Git Integration
1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)
2. Go to [Netlify Dashboard](https://app.netlify.com)
3. Click "New site from Git"
4. Connect your repository
5. Netlify will auto-detect the configuration from `netlify.toml`

### Option 3: Manual Deploy
1. Build the project: `npm run build`
2. Go to [Netlify Dashboard](https://app.netlify.com)
3. Drag and drop the `.next` folder to deploy

## Configuration Details

### Build Settings
- **Build Command**: `npm run build`
- **Publish Directory**: `.next`
- **Node Version**: 18
- **Package Manager**: pnpm (detected from lockfile)

### Features Enabled
- ✅ Next.js SSR/SSG support via `@netlify/plugin-nextjs`
- ✅ Security headers (XSS protection, content-type sniffing, etc.)
- ✅ Static asset caching (1 year for immutable assets)
- ✅ Modern ESBuild bundling for functions

### Environment Variables
If you need to set environment variables:
```bash
netlify env:set VARIABLE_NAME value
```

Or via Netlify Dashboard: Site Settings > Environment Variables

## Troubleshooting

### Build Issues
- **Node Version**: Ensure Node 18+ is being used
- **Package Manager**: Project uses pnpm - make sure Netlify detects this correctly
- **localStorage Warning**: This SSR warning is expected and won't break the build

### Deployment Issues
- Check build logs in Netlify dashboard
- Verify all environment variables are set correctly
- Ensure API endpoints are accessible from deployed environment

### Performance
- Static assets are cached for 1 year
- Consider enabling Netlify's CDN for global distribution
- Monitor Core Web Vitals in Netlify Analytics

## Custom Domain
Once deployed, you can:
1. Go to Site Settings > Domain Management
2. Add custom domain
3. Configure DNS settings as instructed

## Monitoring
- Set up deploy notifications in Site Settings
- Enable Netlify Analytics for traffic insights
- Configure form handling if needed
- Set up branch-based deployments for staging environments
