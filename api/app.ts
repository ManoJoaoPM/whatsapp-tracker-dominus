/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import whatsappRoutes from './routes/whatsapp.js'
import webhookRoutes from './routes/webhooks.js'
import conversationRoutes from './routes/conversations.js'
import analyticsRoutes from './routes/analytics.js'
import adminRoutes from './routes/admin.js'
import clientsRoutes from './routes/clients.js'
import mqlRoutes from './routes/mql.js'
import whatsappAccountsRoutes from './routes/whatsappAccounts.js'
import integrationsRoutes from './routes/integrations.js'
import connectionInviteRoutes from './routes/connectionInvites.js'
import publicConnectRoutes from './routes/publicConnect.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.set('etag', false)

// Behind a reverse proxy (nginx, Traefik...) req.ip would be the proxy. TRUST_PROXY=1 trusts one hop.
if (process.env.TRUST_PROXY) {
  const raw = process.env.TRUST_PROXY.trim()
  app.set('trust proxy', /^\d+$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw)
}

app.use(cors())
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf
    },
  }),
)
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Serve static files from the React frontend app
// We need to resolve the path correctly depending on whether we are in dev (api/app.ts) or prod (dist/app.js)
const frontendDistPath = path.join(__dirname, '../../dist')
app.use(express.static(frontendDistPath))

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/whatsapp', whatsappRoutes)
app.use('/api/whatsapp-accounts', whatsappAccountsRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/clients', clientsRoutes)
app.use('/api/mql', mqlRoutes)
app.use('/api/integrations', integrationsRoutes)
app.use('/api/connection-invites', connectionInviteRoutes)
app.use('/api/public/connect', publicConnectRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * Frontend catch-all route for SPA (React Router)
 */
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'))
})

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
