FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the Node workspaces before copying source so dependency layers can be reused.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci

COPY client ./client
COPY server ./server
COPY python-rag ./python-rag

RUN npm run build \
    && python3 -m venv /opt/python-venv \
    && /opt/python-venv/bin/pip install --no-cache-dir -r /app/python-rag/requirements.txt

ENV PATH="/opt/python-venv/bin:${PATH}"
ENV PORT=10000
EXPOSE 10000

WORKDIR /app/python-rag
CMD ["sh", "-c", "uvicorn main:app --host 127.0.0.1 --port 8000 & exec node /app/server/src/index.js"]
