FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Clone and install moltbot
RUN git clone https://github.com/jsamuel1/moltbot.git /tmp/moltbot && \
    cd /tmp/moltbot && \
    npm install -g . && \
    rm -rf /tmp/moltbot

# Set working directory
WORKDIR /data

# Expose gateway port
EXPOSE 18789

# Run gateway
CMD ["clawdbot", "gateway", "run", "--bind", "0.0.0.0", "--port", "18789"]
