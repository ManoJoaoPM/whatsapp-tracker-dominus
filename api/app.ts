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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.set('etag', false)

app.use(cors())
app.use(express.json({ limit: '10mb' }))
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
app.use('/api/webhooks', webhookRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/clients', clientsRoutes)
app.use('/api/mql', mqlRoutes)

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
