FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install moltbot from npm
RUN npm install -g moltbot@latest

# Set working directory
WORKDIR /data

# Expose gateway port
EXPOSE 18789

# Run gateway
CMD ["clawdbot", "gateway", "run", "--bind", "0.0.0.0", "--port", "18789"]
