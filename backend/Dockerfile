FROM node:18-alpine

WORKDIR /app

# Install Python and build tools needed for some node packages
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Truffle globally
RUN npm install -g truffle

# Copy the rest of the application
COPY . .

# Expose port (if needed for lite-server in future)
EXPOSE 3001

# Default command
CMD ["sh", "-c", "echo 'Backend ready. Run migrations manually or use docker-compose command.'"]

