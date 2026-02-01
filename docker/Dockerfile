FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Clone, build, and install openclaw
RUN git clone https://github.com/jsamuel1/openclaw.git /tmp/openclaw && \
    cd /tmp/openclaw && \
    npm install -g pnpm && \
    pnpm install && \
    pnpm build && \
    npm pack && \
    npm install -g openclaw-*.tgz && \
    rm -rf /tmp/openclaw

# Set working directory and HOME for config persistence on EFS
WORKDIR /data
ENV HOME=/data

# Expose gateway port
EXPOSE 18789

# Run gateway (--allow-unconfigured keeps container alive for initial setup)
CMD ["openclaw", "gateway", "run", "--bind", "0.0.0.0", "--port", "18789", "--allow-unconfigured"]
