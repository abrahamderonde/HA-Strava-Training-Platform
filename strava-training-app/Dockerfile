ARG BUILD_FROM
FROM $BUILD_FROM

# Install Python, Node.js and build tools
RUN apk add --no-cache \
    python3 \
    py3-pip \
    nodejs \
    npm \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    openssl-dev

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

# Build React frontend
COPY frontend /app/frontend
WORKDIR /app/frontend
RUN npm install && npm run build

WORKDIR /app
COPY backend /app/backend

# Copy s6 service scripts
COPY rootfs /

# Data directory
RUN mkdir -p /data/strava_training

EXPOSE 8088

CMD ["python3", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8088"]
