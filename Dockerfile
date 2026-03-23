FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the frontend and backend
RUN npm run build:all

# Production image
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy built backend
COPY --from=builder /app/api/dist ./api/dist
# Copy backend package.json if it exists (for module resolution)
COPY --from=builder /app/api/package*.json ./api/

# Set environment variable to indicate production
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3001

# Start the application
CMD ["node", "api/dist/server.js"]